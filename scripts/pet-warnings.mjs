// SPDX-License-Identifier: AGPL-3.0-only
// print the pet-toxicity warnings (assessed entries with no cat or dog exposure) for every
// catalogue-draft file, so an run sees them in its check step. Exit 0 always: warnings, not errors.
// Usage: node scripts/pet-warnings.mjs [dir]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { petToxicityWarnings } from "../packages/catalogue/src/validate.ts";

export function warningsFor(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => petToxicityWarnings(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

if (
  import.meta.url === new URL(process.argv[1], "file:///").href ||
  process.argv[1]?.endsWith("pet-warnings.mjs")
) {
  const dir =
    process.argv[2] ??
    new URL("../catalogue-draft/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const w = warningsFor(dir);
  console.log(`pets not assessed (${String(w.length)} warnings):`);
  for (const line of w) console.log(`  ${line}`);
}
