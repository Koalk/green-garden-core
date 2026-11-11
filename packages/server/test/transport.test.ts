// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { smtpEndpoint } from "../src/index.ts";

describe("SMTP endpoint defaults", () => {
  it("infers security and port from each other", () => {
    assert.deepEqual(smtpEndpoint({ host: "h" }), { port: 587, secure: "starttls" });
    assert.deepEqual(smtpEndpoint({ host: "h", port: 465 }), { port: 465, secure: "tls" });
    assert.deepEqual(smtpEndpoint({ host: "h", secure: "tls" }), { port: 465, secure: "tls" });
    assert.deepEqual(smtpEndpoint({ host: "h", secure: "none" }), { port: 25, secure: "none" });
    assert.deepEqual(smtpEndpoint({ host: "h", port: 2525, secure: "none" }), {
      port: 2525,
      secure: "none",
    });
  });
});
