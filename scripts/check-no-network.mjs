// SPDX-License-Identifier: AGPL-3.0-only
// Tests must not touch the network: ban network APIs, modules and remote URLs in test files.
// A test file that only holds saved URL strings may opt out of the URL rule (never the call rules)
// with the line `// check-no-network: fixture-urls`.
import { readFileSync } from "node:fs";
import { findNetworkUse } from "./check-no-network-lib.mjs";
import { fail, root, walk } from "./lib.mjs";

const errors = [];
for (const f of walk()) {
  const isTest = /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(f) || f === "vectors/runner.ts";
  if (!isTest) continue;
  for (const hit of findNetworkUse(readFileSync(`${root}/${f}`, "utf8"))) {
    errors.push(`${f}:${hit.line}: ${hit.text}`);
  }
}
if (errors.length) fail("Network use in tests:", errors);
console.log("no-network: ok");
