// SPDX-License-Identifier: AGPL-3.0-only
// Import-boundary check for the module rules in ARCHITECTURE.md ("Modules").
import { readFileSync } from "node:fs";
import { fail, root, walk } from "./lib.mjs";

const scope = "@green-garden/";
// What each package may import from the workspace. Anything else is a violation.
// Nothing may import web-ui or ha-bridge, so neither appears in any list.
const allowed = {
  engine: [],
  i18n: [],
  questions: [],
  bulk: ["catalogue", "i18n", "questions", "storage"],
  "care-text": ["engine", "i18n", "storage"],
  catalogue: ["engine"],
  providers: ["engine"],
  storage: ["engine"],
  client: ["engine", "storage", "catalogue", "providers", "server"],
  server: ["engine", "storage", "catalogue", "providers", "client"],
  "web-ui": [
    "bulk",
    "care-text",
    "engine",
    "i18n",
    "storage",
    "catalogue",
    "providers",
    "questions",
    "client",
    "server",
  ],
  "ha-bridge": ["engine", "storage", "catalogue", "providers", "client", "server"],
  vectors: ["engine"],
};
const importRe =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

const errors = [];
for (const f of walk()) {
  const m = /^(?:packages\/([^/]+)|(vectors))\/.*\.(ts|tsx|js|mjs)$/.exec(f);
  if (!m) continue;
  const pkg = m[1] ?? m[2];
  const pkgDir = m[1] ? `packages/${pkg}` : "vectors";
  const src = readFileSync(`${root}/${f}`, "utf8");
  for (const hit of src.matchAll(importRe)) {
    const spec = hit[1] ?? hit[2] ?? hit[3];
    if (spec.startsWith(".")) {
      const parts = [...f.split("/").slice(0, -1)];
      for (const seg of spec.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      if (!parts.join("/").startsWith(pkgDir))
        errors.push(`${f}: relative import escapes package: ${spec}`);
    } else if (spec.startsWith(scope)) {
      const target = spec.slice(scope.length).split("/")[0];
      if (target !== pkg && !allowed[pkg].includes(target)) {
        errors.push(`${f}: ${pkg} may not import ${target}`);
      }
    } else if (pkg === "engine") {
      errors.push(`${f}: engine must import nothing (found "${spec}")`);
    }
  }
}
if (errors.length) fail("Import boundary violations:", errors);
console.log("boundaries: ok");
