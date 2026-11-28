// The SDKs' types and operation table, generated from the API's OpenAPI document:
//   openapi/openapi.json  ->  npm/src/generated.ts  and  pypi/src/clearpostcode/_generated.py
//
//   node scripts/generate.mjs              write both files from the snapshot
//   node scripts/generate.mjs --check      exit 1 if either file is out of date (the test suites run this)
//   node scripts/generate.mjs --update URL refresh the snapshot first (default https://api.clearpostcode.co.uk/openapi.json;
//                                          a path to a local document works too), then write both files
//
// Every schema becomes a type (TypeScript) and a TypedDict (Python); nested objects get the same names in both. Each
// operation's method, path and query parameters become OPERATIONS, which both clients route from, so an SDK can only
// send the parameters the document lists.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "openapi/openapi.json");
const TS_OUT = join(ROOT, "npm/src/generated.ts");
const PY_OUT = join(ROOT, "pypi/src/clearpostcode/_generated.py");
const LIVE = "https://api.clearpostcode.co.uk/openapi.json";

const args = process.argv.slice(2);
if (args[0] === "--update") {
  const src = args[1] ?? LIVE;
  const text = /^https?:/.test(src) ? await (await fetch(src, { headers: { "user-agent": "clearpostcode-sdk-generator" } })).text() : readFileSync(src, "utf8");
  JSON.parse(text);
  writeFileSync(SNAPSHOT, text.endsWith("\n") ? text : `${text}\n`);
}
const doc = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const SCHEMAS = doc.components.schemas;

/** Names for nested shapes, by their sorted property names (the first shape to claim a name keeps it); others are
 *  Parent + Property (+ Item for an array's items). */
const SHAPES = {
  "latitude,longitude": "Point",
  "outcode,postcodes,type": "DistrictSuggestion",
  "postcode,type": "PostcodeSuggestion",
  "id,kind,postcode,suggestion,udprn,umprn": "SuggestedAddress",
  "count,id,kind,postcode,suggestion,type": "SuggestedContainer",
  "easting,latitude,longitude,northing,positional_quality,positional_quality_label,postcode": "DistanceEnd",
  "code,name,postcodes,share": "AreaShare",
  "code,name,postcodes": "AreaCount",
};
const pascal = (s) => s.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());
const refName = (r) => r.replace("#/components/schemas/", "");
const isObject = (s) => s && s.type === "object" && s.properties;
const nullable = (s) => Array.isArray(s.anyOf) && s.anyOf.length === 2 && s.anyOf.some((x) => x.type === "null");
const inner = (s) => s.anyOf.find((x) => x.type !== "null");

/** Every named type in dependency order: [name, objectSchema, description]. */
const named = new Map();
const byShape = new Map();
function nameFor(schema, suggested) {
  const shape = JSON.stringify(schema);
  if (byShape.has(shape)) return byShape.get(shape);
  const hint = SHAPES[Object.keys(schema.properties).sort().join(",")];
  // Point is a centre that is always there; a point that can be null (a bulk reverse query) keeps its path name.
  const fits = hint && !named.has(hint) && !(hint === "Point" && Object.values(schema.properties).some((v) => Array.isArray(v.type)));
  const name = fits ? hint : suggested;
  if (named.has(name)) throw new Error(`generate: two shapes want the name ${name}`);
  byShape.set(shape, name);
  for (const [k, v] of Object.entries(schema.properties)) visit(v, name + pascal(k));
  named.set(name, schema);
  return name;
}
function visit(s, suggested) {
  if (!s || s.$ref) return;
  if (nullable(s)) return visit(inner(s), suggested);
  if (s.oneOf) return s.oneOf.forEach((x, i) => visit(x, `${suggested}${i}`));
  if (s.type === "array") return visit(s.items, `${suggested}Item`);
  if (isObject(s)) nameFor(s, suggested);
}
/** Components first in dependency order: a component's refs and nested shapes before it. */
const order = [];
const seen = new Set();
function component(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const s = SCHEMAS[name];
  JSON.stringify(s, (k, v) => (k === "$ref" ? (component(refName(v)), v) : v));
  if (isObject(s)) {
    for (const [k, v] of Object.entries(s.properties)) visit(v, name + pascal(k));
    named.set(name, s);
    byShape.set(JSON.stringify(s), name);
  } else if (nullable(s) && isObject(inner(s))) {
    // Named: a nullable object. The object is its own type; the component adds `| null`.
    byShape.set(JSON.stringify(inner(s)), name);
    named.set(name, inner(s));
  } else visit(s, name);
  order.push(name);
}
Object.keys(SCHEMAS).forEach(component);

// ---------------------------------------------------------------------------------------------------- TypeScript
function ts(s) {
  if (s.$ref) return refName(s.$ref) === "Named" ? "Named | null" : refName(s.$ref);
  if (nullable(s)) return `${ts(inner(s))} | null`;
  if (s.oneOf) return s.oneOf.map(ts).join(" | ");
  if ("const" in s) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (Array.isArray(s.type)) return s.type.map((t) => ts({ type: t })).join(" | ");
  if (s.type === "array") {
    const t = ts(s.items);
    return /[ |]/.test(t) ? `(${t})[]` : `${t}[]`;
  }
  if (s.type === "object") return isObject(s) ? byShape.get(JSON.stringify(s)) : "Record<string, unknown>";
  return { string: "string", integer: "number", number: "number", boolean: "boolean", null: "null" }[s.type] ?? "unknown";
}
const doc1 = (text, pad = "") => (text ? `${pad}/** ${text.replace(/\*\//g, "*\\/")} */\n` : "");
function tsInterface(name, s) {
  const req = new Set(s.required ?? []);
  const body = Object.entries(s.properties)
    .map(([k, v]) => `${doc1(v.description ?? (nullable(v) ? inner(v).description : undefined), "  ")}  ${k}${req.has(k) ? "" : "?"}: ${ts(v)};`)
    .join("\n");
  return `${doc1(SCHEMAS[name]?.description)}export interface ${name} {\n${body}\n}`;
}

// -------------------------------------------------------------------------------------------------------- Python
const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);
function py(s) {
  if (s.$ref) return refName(s.$ref) === "Named" ? "Named | None" : refName(s.$ref);
  if (nullable(s)) return `${py(inner(s))} | None`;
  if (s.oneOf) return s.oneOf.map(py).join(" | ");
  if ("const" in s) return `Literal[${JSON.stringify(s.const)}]`;
  if (s.enum) {
    const lits = s.enum.filter((v) => v !== null).map((v) => JSON.stringify(v));
    return `Literal[${lits.join(", ")}]${s.enum.includes(null) ? " | None" : ""}`;
  }
  if (Array.isArray(s.type)) return s.type.map((t) => py({ type: t })).join(" | ");
  if (s.type === "array") return `list[${py(s.items)}]`;
  if (s.type === "object") return isObject(s) ? byShape.get(JSON.stringify(s)) : "dict[str, Any]";
  return { string: "str", integer: "int", number: "float", boolean: "bool", null: "None" }[s.type] ?? "Any";
}
function pyTypedDict(name, s) {
  const req = new Set(s.required ?? []);
  const field = ([k, v]) => (req.has(k) ? py(v) : `NotRequired[${py(v)}]`);
  const entries = Object.entries(s.properties);
  const doc = SCHEMAS[name]?.description;
  if (entries.some(([k]) => PY_KEYWORDS.has(k))) {
    return `${name} = TypedDict(\n    "${name}",\n    {\n${entries.map((e) => `        "${e[0]}": ${field(e)},`).join("\n")}\n    },\n)${doc ? `\n"""${doc}"""` : ""}`;
  }
  const lines = entries.map((e) => {
    const d = e[1].description ?? (nullable(e[1]) ? inner(e[1]).description : undefined);
    return `${d ? `    #: ${d}\n` : ""}    ${e[0]}: ${field(e)}`;
  });
  return `class ${name}(TypedDict):\n${doc ? `    """${doc}"""\n\n` : ""}${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------------------------------- Operations
const ops = [];
const problems = new Set();
for (const [path, methods] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const ok = op.responses["200"].content["application/json"].schema;
    for (const r of Object.values(op.responses)) for (const [ct, c] of Object.entries(r.content ?? {})) if (ct.includes("problem")) Object.keys(c.examples ?? {}).forEach((p) => problems.add(p));
    ops.push({
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      query: (op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name),
      summary: op.summary,
      data: ok.properties.data,
      meta: refName(ok.properties.meta.$ref),
    });
  }
}
const problemList = [...problems].sort();
const header = `Generated by scripts/generate.mjs from openapi/openapi.json (${doc.info.title} ${doc.info.version}). Do not edit.`;

const tsOut = `// ${header}
/* eslint-disable */

export const BASE_URL = ${JSON.stringify(doc.servers[0].url)};

${[...named.keys()].map((n) => tsInterface(n, named.get(n))).join("\n\n")}
${order.filter((n) => !named.has(n)).map((n) => `\nexport type ${n} = ${ts(SCHEMAS[n])};`).join("")}

/** Every problem type the API answers: the fragment of a problem's \`type\` URI. */
export type ProblemCode =\n${problemList.map((p) => `  | ${JSON.stringify(p)}`).join("\n")};

/** Each operation's answer: the type of \`data\` and of \`meta\`. */
export interface OperationTypes {
${ops.map((o) => `  ${o.id}: { data: ${ts(o.data)}; meta: ${o.meta} };`).join("\n")}
}

export type OperationId = keyof OperationTypes;

/** Each operation's method, path and the query parameters it takes. */
export const OPERATIONS = {
${ops.map((o) => `  /** ${o.summary} */\n  ${o.id}: { method: ${JSON.stringify(o.method)}, path: ${JSON.stringify(o.path)}, query: ${JSON.stringify(o.query)} },`).join("\n")}
} as const satisfies Record<OperationId, { method: "GET" | "POST"; path: string; query: readonly string[] }>;
`;

const pyOut = `"""${header}"""

from typing import Any, Literal, NotRequired, TypedDict

BASE_URL = ${JSON.stringify(doc.servers[0].url)}


${[...named.keys()].map((n) => pyTypedDict(n, named.get(n))).join("\n\n\n")}

${order.filter((n) => !named.has(n)).map((n) => `\n${n} = ${py(SCHEMAS[n])}`).join("\n")}

ProblemCode = Literal[
${problemList.map((p) => `    ${JSON.stringify(p)},`).join("\n")}
]
"""Every problem type the API answers: the fragment of a problem's \`type\` URI."""

OPERATIONS: dict[str, tuple[Literal["GET", "POST"], str, tuple[str, ...]]] = {
${ops.map((o) => `    ${JSON.stringify(o.id)}: (${JSON.stringify(o.method)}, ${JSON.stringify(o.path)}, (${o.query.map((q) => JSON.stringify(q)).join(", ")}${o.query.length === 1 ? "," : ""})),`).join("\n")}
}
"""Each operation's method, path and the query parameters it takes."""

__all__ = [
${["BASE_URL", "OPERATIONS", "ProblemCode", ...named.keys(), ...order.filter((n) => !named.has(n))].sort().map((n) => `    ${JSON.stringify(n)},`).join("\n")}
]
`;

const outputs = [
  [TS_OUT, tsOut],
  [PY_OUT, pyOut],
];
if (args[0] === "--check") {
  const stale = outputs.filter(([f, text]) => {
    try {
      return readFileSync(f, "utf8") !== text;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(`generate: out of date: ${stale.map(([f]) => f.replace(`${ROOT}/`, "")).join(", ")}. Run node scripts/generate.mjs.`);
    process.exit(1);
  }
} else {
  for (const [f, text] of outputs) writeFileSync(f, text);
  console.log(`generate: ${named.size} types, ${ops.length} operations, ${problemList.length} problem codes`);
}
