// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { warningsFor } from "./pet-warnings.mjs";

describe("pet-warnings", () => {
  it("lists assessed entries with no cat or dog exposure, across files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pw-"));
    const entry = (id, who) => ({
      id,
      toxicity: { status: "assessed", exposures: who.map((w) => ({ who: w, severity: 1 })) },
    });
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify({ entries: [entry("a1", ["child"]), entry("a2", ["cat"])] }),
    );
    writeFileSync(join(dir, "b.json"), JSON.stringify({ entries: [entry("b1", ["adult"])] }));
    const w = warningsFor(dir);
    assert.equal(w.length, 2);
    assert.match(w.join("\n"), /a1/);
    assert.match(w.join("\n"), /b1/);
  });
});
