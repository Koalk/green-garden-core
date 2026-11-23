// SPDX-License-Identifier: AGPL-3.0-only
// Static preview build of the web UI: plain files any static host can serve (GitHub Pages), no server.
//   node scripts/build-static.mjs [outDir]      (default: dist/static)
// The browser needs no bundler: the packages are ES modules, so this only strips the TypeScript types
// (Node's own `stripTypeScriptTypes`, the same call the dev server makes per request), renames .ts to .js
// (static hosts serve .ts with a video MIME type, which browsers refuse as a module), and makes every
// path relative so the site works under a sub-path such as /<repo>/. The page sets
// `__GG_STATIC_PREVIEW__` before the app loads: the UI then hides everything that needs a server.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScript } from "../packages/web-ui/dev/build-info.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Relative imports and exports ending in .ts, in the stripped source of a module. */
function renameSpecifiers(src) {
  return src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)"(\.{1,2}\/[^"]+)\.ts"/g, '$1"$2.js"');
}

function copyPackageSource(name, out) {
  const from = join(repo, "packages", name, "src");
  const entries = readdirSync(from, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const src = join(e.parentPath, e.name);
    const rel = src.slice(from.length + 1);
    const dest = join(out, "packages", name, "src", rel.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(dest), { recursive: true });
    if (e.name.endsWith(".ts")) {
      writeFileSync(dest, renameSpecifiers(stripTypeScriptTypes(readFileSync(src, "utf8"))));
    } else if (e.name.endsWith(".json")) {
      cpSync(src, dest);
    }
  }
}

/** Builds the preview into `out` (emptied first) and returns it. */
export function buildStatic(out = join(repo, "dist", "static")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const page = readFileSync(join(repo, "packages", "web-ui", "index.html"), "utf8");
  const importmap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page);
  if (importmap === null) throw new Error("index.html has no import map");
  const map = JSON.parse(importmap[1]);
  const packages = Object.values(map.imports).map((p) => /^\/packages\/([^/]+)\//.exec(p)[1]);
  for (const name of new Set([...packages, "web-ui"])) copyPackageSource(name, out);
  const relative = (p) => p.replace(/^\/(packages\/.*)\.ts$/, "./$1.js");
  const imports = Object.fromEntries(Object.entries(map.imports).map(([k, v]) => [k, relative(v)]));
  const html = page
    .replace(importmap[0], () => {
      const flag = "<script>globalThis.__GG_STATIC_PREVIEW__ = true;</script>";
      return `${flag}\n    ${buildScript()}\n    <script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n    </script>`;
    })
    .replace(
      '<link rel="stylesheet" href="/vendor/',
      '<link rel="icon" href="data:," />\n    <link rel="stylesheet" href="./vendor/',
    )
    .replace('src="/packages/web-ui/src/app.ts"', 'src="./packages/web-ui/src/app.js"')
    .replace(
      "<title>Green Garden Core (provisional)</title>",
      "<title>Green Garden Core (preview)</title>",
    );
  writeFileSync(join(out, "index.html"), html);
  mkdirSync(join(out, "vendor"), { recursive: true });
  const pico = createRequire(join(repo, "packages", "web-ui", "package.json")).resolve(
    "@picocss/pico/css/pico.green.min.css",
  );
  cpSync(pico, join(out, "vendor", "pico.green.min.css"));
  cpSync(join(repo, "packages", "catalogue", "thumbs"), join(out, "catalogue-thumbs"), {
    recursive: true,
  });
  writeFileSync(join(out, ".nojekyll"), "");
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] === undefined ? undefined : join(process.cwd(), process.argv[2]);
  console.log(`static preview built in ${buildStatic(out)}`);
}
