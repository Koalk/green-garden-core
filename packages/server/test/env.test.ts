// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listenOptions, parseDotEnv } from "../src/index.ts";

describe("server environment", () => {
  it("reads KEY=value lines, skipping comments and stripping quotes", () => {
    const env = parseDotEnv('# c\nA=1\n\nB = "two words"\nC=\n');
    assert.deepEqual(env, { A: "1", B: "two words", C: "" });
  });

  it("binds like the dev server: all interfaces unless HOST says otherwise", () => {
    assert.deepEqual(listenOptions({}), { host: "0.0.0.0", port: 8080 });
    assert.deepEqual(listenOptions({ HOST: "127.0.0.1", PORT: "9000" }), {
      host: "127.0.0.1",
      port: 9000,
    });
  });
});
