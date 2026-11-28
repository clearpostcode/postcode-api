// The package build: dist/esm (tsc: ES modules and declarations), dist/cjs (the same modules as CommonJS, converted by
// esbuild, with the declarations beside them and a package.json that marks the folder CommonJS). Declarations import
// ./x.js, as the modules do.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
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
const files = readdirSync(esm, { recursive: true }).map(String);
await build({ entryPoints: files.filter((f) => f.endsWith(".js")).map((f) => join(esm, f)), outdir: cjs, outbase: esm, format: "cjs", platform: "neutral", target: "es2022", bundle: false, logLevel: "warning" });
// Declarations keep the source's ./x.ts specifiers; consumers resolve ./x.js (beside x.d.ts).
for (const f of files.filter((f) => f.endsWith(".d.ts"))) {
  mkdirSync(dirname(join(cjs, f)), { recursive: true });
  const text = readFileSync(join(esm, f), "utf8").replace(/((?:from|import\()\s*["']\.{1,2}\/[^"']+)\.ts(["'])/g, "$1.js$2");
  writeFileSync(join(esm, f), text);
  writeFileSync(join(cjs, f), text);
}
writeFileSync(join(cjs, "package.json"), '{ "type": "commonjs" }\n');

// The finder as one file for a script tag (self-hosted or from a CDN), and its stylesheet: 10 KB gzipped at most.
const { VERSION } = await import(join(ROOT, "src/version.ts"));
const banner = `/*! ClearPostcode finder ${VERSION} | MIT | https://github.com/clearpostcode/postcode-api */`;
await build({ entryPoints: [join(ROOT, "src/widget/auto.ts")], outfile: join(DIST, "widget.js"), bundle: true, minify: true, format: "iife", target: "es2022", legalComments: "none", banner: { js: banner }, logLevel: "warning" });
await build({ entryPoints: [join(ROOT, "src/widget/widget.css")], outfile: join(DIST, "widget.css"), bundle: true, minify: true, banner: { css: banner }, logLevel: "warning" });
const gz = (f) => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length;
const sizes = { js: gz("widget.js"), css: gz("widget.css") };
if (sizes.js + sizes.css > 10 * 1024) throw new Error(`build: widget.js + widget.css are ${sizes.js + sizes.css} bytes gzipped, over 10 KB`);
console.log(`build: ${files.filter((f) => f.endsWith(".js")).length} modules, ESM and CommonJS; widget.js ${sizes.js} B + widget.css ${sizes.css} B gzipped`);
