// SPDX-License-Identifier: AGPL-3.0-only
// Vectors for the public-repo check: each case is planted in a temp tree.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { REPORT_ONLY_KINDS, scanFiles } from "./public-check-lib.mjs";

// Planted values are built in pieces so this file does not trip the check it tests.
const STORIES = "green-garden" + "-stories/docs/x.md";
const PLANNING = "docs/" + "planning/PLAN.md";
const CONTEXT = "PROJECT" + "_CONTEXT.md";
const LEGAL = "docs/" + "legal/notes.md";
const TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";
const EMAIL = "someone" + "@gmail.com";
const PHONE = "+44 7700 " + "900123";
const IP = "10.0." + "4.17";
const COORD = "lat: 55." + "953251, lon: -3." + "188267";
const DANI = "Da" + "ni";
const DANIEL = "Dan" + "iel";
const HEX = "a".repeat(8) + "0123456789abcdef".repeat(4);

/** Plant files in a temp tree, scan them, return findings as "file:line: kind". */
function scan(files, allow = []) {
  const dir = mkdtempSync(join(tmpdir(), "pubcheck-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
    return scanFiles(dir, Object.keys(files), allow).map((f) => `${f.file}:${f.line}: ${f.kind}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a clean file has no findings", () => {
  assert.deepEqual(scan({ "a.md": "Plants need water.\nUse you@example.com.\n" }), []);
});

test("private repo paths and links fail with file:line", () => {
  for (const [text, label] of [
    [STORIES, "stories"],
    [PLANNING, "planning"],
    [CONTEXT, "context"],
    [LEGAL, "legal"],
  ]) {
    assert.deepEqual(scan({ "a.md": `ok\nsee ${text}\n` }), ["a.md:2: private-path"], label);
  }
});

test("secrets by pattern fail", () => {
  assert.deepEqual(scan({ "a.ts": `const t = "${TOKEN}";` }), ["a.ts:1: secret"]);
  assert.deepEqual(scan({ "a.ts": `const t = "${AWS}";` }), ["a.ts:1: secret"]);
  assert.deepEqual(scan({ "a.ts": `const k = "${HEX}";` }), ["a.ts:1: secret"]);
});

test("long hex strings are fine in tests and fixtures", () => {
  assert.deepEqual(
    scan({ "a.test.ts": `const k = "${HEX}";`, "scripts/fixtures/x.json": `"${HEX}"` }),
    [],
  );
});

test(".env files fail except .env.example", () => {
  assert.deepEqual(scan({ ".env": "X=1\n" }), [".env:1: env-file"]);
  assert.deepEqual(scan({ "app/.env.local": "X=1\n" }), ["app/.env.local:1: env-file"]);
  assert.deepEqual(scan({ ".env.example": "X=\n" }), []);
});

test("personal data fails: email, phone, private IP, coordinates", () => {
  assert.deepEqual(scan({ "a.md": `mail ${EMAIL}` }), ["a.md:1: email"]);
  assert.deepEqual(scan({ "a.md": `call ${PHONE}` }), ["a.md:1: phone"]);
  assert.deepEqual(scan({ "a.md": `host ${IP}` }), ["a.md:1: private-ip"]);
  assert.deepEqual(scan({ "a.md": COORD }), ["a.md:1: coordinates"]);
});

test("documented example addresses pass", () => {
  assert.deepEqual(
    scan({
      "a.md":
        "broker mqtt://192.168.1.5:1883 and user@example.org, noreply@users.noreply.github.com",
    }),
    [],
  );
});

test("an allow-list entry exempts one kind in one file, and needs a reason", () => {
  const files = { "a.md": `host ${IP}` };
  assert.deepEqual(
    scan(files, [{ file: "a.md", kind: "private-ip", reason: "documented example" }]),
    [],
  );
  assert.deepEqual(scan(files, [{ file: "a.md", kind: "email", reason: "wrong kind" }]), [
    "a.md:1: private-ip",
  ]);
  assert.throws(() => scan(files, [{ file: "a.md", kind: "private-ip", reason: "" }]), /reason/);
});

test("the owner's name fails outside licence, copyright and credit lines", () => {
  assert.deepEqual(scan({ "a.md": `ok\nAsk ${DANI} first.\n` }), ["a.md:2: owner-name"]);
  assert.deepEqual(scan({ "a.ts": `// ${DANIEL} wrote this` }), ["a.ts:1: owner-name"]);
  assert.deepEqual(scan({ "a.md": `Copyright (c) 2026 ${DANI}` }), []);
  assert.deepEqual(scan({ LICENSE: `${DANI} holds the copyright` }), []);
  assert.deepEqual(scan({ "THIRD_PARTY.md": `Photo by ${DANIEL}` }), []);
});

test("dated owner decisions fail", () => {
  assert.deepEqual(scan({ "a.md": `${DANI} 2026-11-11 decided` }), [
    "a.md:1: owner-name",
    "a.md:1: decision-date",
  ]);
  assert.deepEqual(scan({ "a.md": "Decided 2026-11-11: use X" }), ["a.md:1: decision-date"]);
});

test("session IDs and review tags fail", () => {
  for (const text of [
    "S" + "247 did this",
    "PROVISIONAL(" + "S06)",
    "V" + "-8 found",
    "orch" + "41 row",
    "IN" + "-S245-2",
  ]) {
    assert.deepEqual(scan({ "a.ts": `// ${text}` }), ["a.ts:1: session-id"], text);
  }
  assert.deepEqual(scan({ "a.ts": "// PROVISIONAL: see the rule below, S3 pin, ES256" }), []);
});

test("consent, employer and legal-decision wording fails", () => {
  for (const text of [
    "employer " + "consent",
    "the Employ" + "ment status",
    "legal " + "decision",
  ]) {
    assert.deepEqual(scan({ "a.md": text }), ["a.md:1: private-matter"], text);
  }
});

test("new rules are report-only kinds, old ones stay failing", () => {
  assert.deepEqual([...REPORT_ONLY_KINDS].sort(), [
    "decision-date",
    "owner-name",
    "private-matter",
    "session-id",
  ]);
  assert.ok(!REPORT_ONLY_KINDS.has("secret"));
  assert.ok(!REPORT_ONLY_KINDS.has("private-path"));
});
