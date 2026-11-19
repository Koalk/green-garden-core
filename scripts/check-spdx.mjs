// SPDX-License-Identifier: AGPL-3.0-only
// Every source file must carry an SPDX header within its first two lines.
import { readFileSync } from "node:fs";
import { fail, root, walk } from "./lib.mjs";

const want = "SPDX-License-Identifier: AGPL-3.0-only";
const bad = walk().filter(
  (f) =>
    /\.(ts|tsx|js|mjs|cjs)$/.test(f) &&
    !readFileSync(`${root}/${f}`, "utf8")
      .split("\n")
      .slice(0, 2)
      .some((l) => l.includes(want)),
);
if (bad.length) fail(`Missing "${want}" header:`, bad);
console.log("spdx: ok");
