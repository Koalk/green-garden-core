// SPDX-License-Identifier: AGPL-3.0-only
// check-no-network: fixture-urls
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_URLS, findNetworkUse } from "./check-no-network-lib.mjs";

// Built in pieces so this file does not trip the guard it tests.
const IMPORT = 'import http from "node:' + 'http";';
const SOCKET = "new Web" + 'Socket("wss://x.test");';
const CALL = "await fe" + 'tch("https://example.org/a");';

test("a remote URL in a test file fails by default", () => {
  assert.equal(findNetworkUse('const u = "https://example.org/a";').length, 1);
});

test("localhost URLs are fine", () => {
  assert.equal(findNetworkUse('const u = "http://localhost:3000/a";').length, 0);
});

test("the fixture-urls directive allows URL strings", () => {
  assert.equal(findNetworkUse(`${FIXTURE_URLS}\nconst u = "https://example.org/a";`).length, 0);
});

test("the directive does not allow a real fetch call", () => {
  assert.deepEqual(findNetworkUse(`${FIXTURE_URLS}\n${CALL}`), [{ line: 2, text: CALL }]);
});

test("the directive does not allow network modules or sockets", () => {
  assert.equal(findNetworkUse(`${FIXTURE_URLS}\n${IMPORT}`).length, 1);
  assert.equal(findNetworkUse(`${FIXTURE_URLS}\n${SOCKET}`).length, 1);
});
