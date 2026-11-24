// Builds postman/clear-postcode.postman_collection.json from the live OpenAPI document.
// Usage: node postman/generate.mjs [openapi-url-or-file]   (default: https://clearpostcode.co.uk/openapi.json)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2] ?? "https://clearpostcode.co.uk/openapi.json";
const spec = JSON.parse(src.startsWith("http") ? await (await fetch(src)).text() : await readFile(src, "utf8"));
const out = join(dirname(fileURLToPath(import.meta.url)), "clear-postcode.postman_collection.json");

const sample = (p) => String(p.example ?? p.schema?.example ?? p.schema?.default ?? "");
const items = new Map();

for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!["get", "post"].includes(method)) continue;
    const params = op.parameters ?? [];
    const pathParams = params.filter((p) => p.in === "path");
    const query = params.filter((p) => p.in === "query");
    const segments = path.split("/").filter(Boolean).map((s) => {
      const m = /^\{(.+)\}$/.exec(s);
      return m ? encodeURIComponent(sample(pathParams.find((p) => p.name === m[1]) ?? {})) : s;
    });
    const body = op.requestBody?.content?.["application/json"];
    const description = [op.description ?? op.summary, op["x-billing"] && `Billing: ${op["x-billing"]}`, op["x-status"] && `Status: ${op["x-status"]}`]
      .filter(Boolean)
      .join("\n\n");
    const request = {
      method: method.toUpperCase(),
      header: [
        { key: "x-api-key", value: "{{apiKey}}", description: "Optional on keyless endpoints. cp_live_ (secret) or cp_pub_ (publishable)." },
        { key: "accept", value: "application/json" },
        ...(body ? [{ key: "content-type", value: "application/json" }] : []),
      ],
      url: {
        raw: `{{baseUrl}}/${segments.join("/")}${query.length ? "?" + query.map((p) => `${p.name}=${encodeURIComponent(sample(p))}`).join("&") : ""}`,
        host: ["{{baseUrl}}"],
        path: segments,
        query: query.map((p) => ({ key: p.name, value: encodeURIComponent(sample(p)), description: p.description, disabled: !p.required })),
      },
      description,
      ...(body ? { body: { mode: "raw", raw: JSON.stringify(body.example ?? {}, null, 2), options: { raw: { language: "json" } } } } : {}),
    };
    const tag = op.tags?.[0] ?? "Other";
    if (!items.has(tag)) items.set(tag, []);
    items.get(tag).push({ name: op.summary ?? op.operationId, request });
  }
}

const collection = {
  info: {
    name: "Clear Postcode API",
    description: `${spec.info.description ?? ""}\n\nSet the apiKey collection variable to your key (free at https://clearpostcode.co.uk/developers). Most endpoints also work with it empty. Docs: https://clearpostcode.co.uk/developers/docs`,
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    version: spec.info.version,
  },
  variable: [
    { key: "baseUrl", value: spec.servers?.[0]?.url ?? "https://api.clearpostcode.co.uk/v1" },
    { key: "apiKey", value: "" },
  ],
  item: [...items].map(([name, item]) => ({ name, item })),
};
await writeFile(out, JSON.stringify(collection, null, 2) + "\n");
console.log(`${out}: ${[...items.values()].flat().length} requests in ${items.size} folders`);
