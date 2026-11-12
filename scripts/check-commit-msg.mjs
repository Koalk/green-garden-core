// SPDX-License-Identifier: AGPL-3.0-only
// Core is public, so its commit messages are too: refuse session IDs and the owner's name.
//   node scripts/check-commit-msg.mjs <message-file>      (the commit-msg hook)
//   node scripts/check-commit-msg.mjs --range <git-range>  (CI; allow-list: commit-msg-allow.json)
// Output names the commit and kind only; it never prints the matched text.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkCommitMessage } from "./public-check-lib.mjs";
import { fail, root } from "./lib.mjs";

const [mode, arg] = process.argv.slice(2);
if (mode === "--range") {
  const allow = JSON.parse(readFileSync(`${root}/scripts/commit-msg-allow.json`, "utf8"));
  for (const e of allow) {
    if (!e.commit || !e.kind || !String(e.reason ?? "").trim())
      throw new Error(`allow-list entry needs commit, kind and a reason: ${JSON.stringify(e)}`);
  }
  const out = execFileSync("git", ["log", "-z", "--format=%H%n%B", arg], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  const findings = [];
  for (const rec of out.split("\0").filter((r) => r.trim())) {
    const nl = rec.indexOf("\n");
    const hash = rec.slice(0, nl).trim();
    for (const kind of checkCommitMessage(rec.slice(nl + 1))) {
      if (!allow.some((e) => e.commit === hash && e.kind === kind))
        findings.push(`${hash.slice(0, 7)}: ${kind}`);
    }
  }
  if (findings.length) fail("Commit message check failed:", findings);
  console.log("commit-msg check: ok");
} else {
  const kinds = checkCommitMessage(readFileSync(mode, "utf8"));
  if (kinds.length) {
    console.error(`commit-msg: message contains ${kinds.join(", ")}; core is public, reword it.`);
    process.exit(1);
  }
}
