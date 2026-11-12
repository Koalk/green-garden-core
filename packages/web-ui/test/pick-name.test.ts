// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameAfterPick } from "../src/placement.ts";

describe("Add plant: the name after picking a species", () => {
  it("fills an empty name", () => {
    assert.deepEqual(nameAfterPick("", undefined, "Pothos"), { name: "Pothos", auto: "Pothos" });
  });

  it("replaces the name the last pick filled in when another species is picked", () => {
    assert.deepEqual(nameAfterPick("Pothos", "Pothos", "Chinese money plant"), {
      name: "Chinese money plant",
      auto: "Chinese money plant",
    });
  });

  it("keeps a name the person typed or changed", () => {
    assert.deepEqual(nameAfterPick("Gerald", "Pothos", "Chinese money plant"), {
      name: "Gerald",
      auto: undefined,
    });
    assert.deepEqual(nameAfterPick("Gerald", undefined, "Pothos"), {
      name: "Gerald",
      auto: undefined,
    });
  });
});
