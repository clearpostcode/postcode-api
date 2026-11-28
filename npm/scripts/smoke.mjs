// Live smoke test against the production API, on the built package (npm run smoke). Every ```js block in README.md runs
// as printed (```js secret blocks only with a secret key in CLEAR_POSTCODE_KEY; ```js cjs as CommonJS), and each line it
// prints must match the README's `// expected` comment (the text before any ": " note). Then the contract: snake_case
// districts, cursor paging, typed problems with request ids, rate limits. About 30 requests a run.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ClearPostcode, AuthenticationError, BadRequestError, NotFoundError, PermissionDeniedError } from "clearpostcode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".smoke");
const secret = (process.env.CLEAR_POSTCODE_KEY ?? "").startsWith("cp_live_");
let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
};

/** The output a block promises: `console.log(...) // x` or a comment line straight after a console.log line. */
function expected(code) {
  const out = [];
  const lines = code.split("\n");
  lines.forEach((l, i) => {
    if (!/console\.log\(/.test(l)) return;
    const inline = l.match(/\/\/ (.+)$/)?.[1];
    const next = lines[i + 1]?.match(/^\s*\/\/ (.+)$/)?.[1];
    const text = inline ?? next;
    if (text) out.push(text.split(": ")[0]);
  });
  return out;
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR);
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const blocks = [...readme.matchAll(/```js( \w+)?\n([\s\S]*?)```/g)];
for (const [i, b] of blocks.entries()) {
  const tag = b[1]?.trim() ?? "";
  const name = `README block ${i + 1}${tag ? ` (${tag})` : ""}: ${b[2].split("\n").find((l) => /(cp|\))\.\w+\.\w+\(/.test(l) && !l.startsWith("//"))?.trim().slice(0, 60)}`;
  if (tag === "secret" && !secret) {
    console.log(`skip  ${name} (needs a secret key in CLEAR_POSTCODE_KEY)`);
    continue;
  }
  const file = join(DIR, `block${i + 1}.${tag === "cjs" ? "cjs" : "mjs"}`);
  writeFileSync(file, b[2]);
  await check(name, () => {
    const out = execFileSync(process.execPath, [file], { cwd: DIR, encoding: "utf8", env: process.env }).trim().split("\n").filter(Boolean);
    const want = expected(b[2]);
    want.forEach((w, j) => assert.ok(out[j]?.startsWith(w), `line ${j + 1}: printed "${out[j]}", the README says "${w}"`));
  });
}
rmSync(DIR, { recursive: true, force: true });

const cp = new ClearPostcode();
await check("districts are snake_case with a centre point", async () => {
  const { data, meta } = await cp.outcodes.get("SW1A");
  assert.equal(data.area_name, "South West London");
  assert.equal(typeof data.centre?.latitude, "number");
  assert.ok(data.local_authorities.length > 0 && typeof data.large_user === "number");
  assert.match(meta.next_edition, /^\d{4}-\d{2}$/);
  assert.ok(meta.next_edition_expected.from && meta.next_edition_expected.to);
});
await check("areas list each district's local_authority", async () => {
  const { data } = await cp.areas.get("SW");
  assert.ok("local_authority" in (data.districts[0] ?? {}));
});
await check("a sector, places, nearest, reverse and distance answer", async () => {
  assert.ok((await cp.sectors.get("SW1A 1")).data.postcodes.length > 0);
  assert.ok((await cp.places.search("Chelsea")).data.some((p) => p.district === "SW3"));
  assert.equal((await cp.postcodes.nearest("SW1A 1AA", { limit: 2 })).data.length, 2);
  const r = await cp.postcodes.reverse({ latitude: 51.501, longitude: -0.1416, radius: 1000, limit: 3 });
  assert.equal(r.meta.radius_m, 1000);
  assert.ok(r.data.length > 0);
  assert.ok((await cp.postcodes.distance("SW1A 1AA", "EH1 1YZ")).data.km > 500);
});
await check("a terminated postcode answers with its replacement; Northern Ireland is checked by format", async () => {
  const t = await cp.postcodes.lookup("AB1 0AA", { fields: ["replaced_by", "terminated"] });
  assert.equal(t.data.status, "terminated");
  assert.ok(t.data.replaced_by);
  const bt = await cp.postcodes.validate("BT1 1AA");
  assert.equal(bt.data.coverage, "not_covered");
  assert.equal(bt.data.format_valid, true);
});
await check("problems are typed and carry request ids", async () => {
  const bad = await cp.postcodes.lookup("ZZ1 1ZZ").catch((e) => e);
  assert.ok(bad instanceof BadRequestError && bad.code === "invalid_postcode" && bad.requestId, String(bad));
  const nf = await cp.postcodes.lookup("SW1A 9ZZ").catch((e) => e);
  assert.ok(nf instanceof NotFoundError && nf.code === "postcode_not_found", String(nf));
});
await check("keyless calls carry rate limits; secret-key calls refuse keyless callers with key_required", async () => {
  const r = await cp.postcodes.validate("M1 1AE");
  assert.ok(r.rateLimit && r.rateLimit.limit && r.rateLimit.remaining !== null && r.rateLimit.policy, JSON.stringify(r.rateLimit));
  if (secret) return;
  const u = await cp.account.usage().catch((e) => e);
  assert.ok(u instanceof AuthenticationError && u.code === "key_required", String(u));
  const p = await cp.outcodes.postcodes("SW1A").catch((e) => e);
  assert.ok(p instanceof AuthenticationError, String(p));
});
await check("address lookup answers keyless callers with a typed refusal", async () => {
  const a = await cp.addresses.suggest("2 high street").catch((e) => e);
  assert.ok((a instanceof PermissionDeniedError && a.code === "address_lookup_not_enabled") || (a instanceof AuthenticationError && a.code === "key_required"), String(a));
});

console.log(failed ? `\n${failed} failed` : "\nsmoke: all good");
process.exit(failed ? 1 : 0);
