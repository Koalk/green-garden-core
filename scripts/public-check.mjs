// SPDX-License-Identifier: AGPL-3.0-only
// Core is public: fail on private Stories paths, secrets, .env files or personal data in any
// tracked file. Reviewed exceptions go in scripts/public-check-allow.json, each with a reason.
// Output names file, line and kind only; it never prints the matched value.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { REPORT_ONLY_KINDS, scanFiles } from "./public-check-lib.mjs";
import { fail, root } from "./lib.mjs";

const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1 << 26,
})
  .split("\0")
  .filter(Boolean);
const allow = JSON.parse(readFileSync(`${root}/scripts/public-check-allow.json`, "utf8"));
// --report lists the owner-name, decision-date, session-id and private-matter findings without failing (for a first look at a tree).
const report = process.argv.includes("--report");
const all = scanFiles(root, files, allow);
const reported = report ? all.filter((f) => REPORT_ONLY_KINDS.has(f.kind)) : [];
const findings = all.filter((f) => !reported.includes(f));
if (reported.length) {
  const perFile = new Map();
  for (const f of reported) perFile.set(f.file, (perFile.get(f.file) ?? 0) + 1);
  console.log(`public-check (report only): ${reported.length} findings in ${perFile.size} files`);
  if (process.argv.includes("--verbose"))
    for (const f of reported) console.log(`  ${f.file}:${f.line}: ${f.kind}`);
}
if (findings.length)
  fail(
    "Public check failed:",
    findings.map((f) => `${f.file}:${f.line}: ${f.kind}`),
  );
console.log("public-check: ok");
