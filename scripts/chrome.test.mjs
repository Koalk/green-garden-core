// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { failureMessage, readDevToolsPort, waitForPort } from "./chrome.mjs";

const profile = () => mkdtempSync(join(tmpdir(), "chrome-test-"));

test("readDevToolsPort reads the first line of DevToolsActivePort", () => {
  const dir = profile();
  writeFileSync(join(dir, "DevToolsActivePort"), "40123\n/devtools/browser/abc\n");
  assert.equal(readDevToolsPort(dir), 40123);
  rmSync(dir, { recursive: true, force: true });
});

test("readDevToolsPort is undefined while the file is missing, empty or half-written", () => {
  const dir = profile();
  assert.equal(readDevToolsPort(dir), undefined);
  writeFileSync(join(dir, "DevToolsActivePort"), "");
  assert.equal(readDevToolsPort(dir), undefined);
  writeFileSync(join(dir, "DevToolsActivePort"), "40a");
  assert.equal(readDevToolsPort(dir), undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("waitForPort returns the port once the file appears", async () => {
  const dir = profile();
  setTimeout(() => writeFileSync(join(dir, "DevToolsActivePort"), "5555\n/x\n"), 100);
  assert.equal(await waitForPort(dir, { timeoutMs: 3000, pollMs: 20 }), 5555);
  rmSync(dir, { recursive: true, force: true });
});

test("waitForPort gives undefined after the timeout, or when Chrome has already exited", async () => {
  const dir = profile();
  assert.equal(await waitForPort(dir, { timeoutMs: 100, pollMs: 20 }), undefined);
  assert.equal(
    await waitForPort(dir, { timeoutMs: 5000, pollMs: 20, exited: () => true }),
    undefined,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("failureMessage names the wait, the exit code and the last stderr lines", () => {
  const stderr = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const m = failureMessage({ timeoutMs: 30000, exitCode: 133, stderr });
  assert.match(m, /Chrome did not open a page within 30 s/);
  assert.match(m, /exit code 133/);
  assert.match(m, /line 29/);
  assert.doesNotMatch(m, /line 5\b/);
  assert.match(failureMessage({ timeoutMs: 1000, exitCode: null, stderr: "" }), /still running/);
  assert.match(failureMessage({ timeoutMs: 1000, exitCode: null, stderr: "" }), /no stderr/);
});
