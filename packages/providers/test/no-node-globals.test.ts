// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

describe("weather path in a runtime without Node globals", () => {
  it("loads and answers with no process and no Buffer", () => {
    const out = execFileSync(
      process.execPath,
      [new URL("no-node-globals.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
      { encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(out.trim()), {
      process: "undefined",
      buffer: "undefined",
      days: 2,
      tMinC: 1,
    });
  });
});
