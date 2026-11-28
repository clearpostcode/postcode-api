// The package build: dist/esm (tsc: ES modules and declarations), dist/cjs (the same modules as CommonJS, converted by
// esbuild, with the declarations beside them and a package.json that marks the folder CommonJS). Declarations import
// ./x.js, as the modules do.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
rmSync(DIST, { recursive: true, force: true });
execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", join(ROOT, "tsconfig.build.json")], { stdio: "inherit" });

const esm = join(DIST, "esm");
const cjs = join(DIST, "cjs");
mkdirSync(cjs, { recursive: true });
const files = readdirSync(esm);
await build({ entryPoints: files.filter((f) => f.endsWith(".js")).map((f) => join(esm, f)), outdir: cjs, format: "cjs", platform: "neutral", target: "es2022", bundle: false, logLevel: "warning" });
// Declarations keep the source's ./x.ts specifiers; consumers resolve ./x.js (beside x.d.ts).
for (const f of files.filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(join(esm, f), "utf8").replace(/((?:from|import\()\s*["']\.{1,2}\/[^"']+)\.ts(["'])/g, "$1.js$2");
  writeFileSync(join(esm, f), text);
  writeFileSync(join(cjs, f), text);
}
writeFileSync(join(cjs, "package.json"), '{ "type": "commonjs" }\n');
console.log(`build: ${files.filter((f) => f.endsWith(".js")).length} modules, ESM and CommonJS`);
