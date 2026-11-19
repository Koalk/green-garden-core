// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const skip = new Set(["node_modules", ".git", ".pnpm-store", "dist", "coverage"]);

/** All files under dir (repo-relative, forward slashes), skipping vendored/build dirs. */
export function walk(dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

export function fail(title, lines) {
  console.error(`${title}\n${lines.map((l) => `  ${l}`).join("\n")}`);
  process.exit(1);
}
