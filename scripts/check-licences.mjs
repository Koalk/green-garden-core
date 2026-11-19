// SPDX-License-Identifier: AGPL-3.0-only
// Dependency licence gate: every installed package must carry a permissive licence.
// Reads node_modules/.pnpm, so run it after pnpm install.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fail, root } from "./lib.mjs";

const permissive = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC0-1.0",
  "Unlicense",
]);

// "A OR B": one permissive alternative is enough. "A AND B": every part must be permissive.
const ok = (expr) =>
  expr
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((t) => permissive.has(t.trim())));

const store = `${root}/node_modules/.pnpm`;
if (!existsSync(store)) fail("No node_modules/.pnpm: run pnpm install first.", []);

const seen = new Map();
for (const entry of readdirSync(store)) {
  const nm = `${store}/${entry}/node_modules`;
  if (!existsSync(nm)) continue;
  for (const name of readdirSync(nm)) {
    const dirs = name.startsWith("@")
      ? readdirSync(`${nm}/${name}`).map((n) => `${name}/${n}`)
      : [name];
    for (const d of dirs) {
      const p = `${nm}/${d}/package.json`;
      if (!existsSync(p) || d.startsWith("@green-garden/")) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      const lic =
        typeof j.license === "string"
          ? j.license
          : (j.license?.type ?? (j.licenses ?? []).map((l) => l.type).join(" OR "));
      seen.set(`${j.name}@${j.version}`, lic || "UNKNOWN");
    }
  }
}
const bad = [...seen].filter(([, l]) => !ok(l)).map(([k, l]) => `${k}: ${l}`);
if (bad.length) fail("Non-permissive or unknown licences:", bad);
console.log(`licences: ok (${seen.size} packages)`);
