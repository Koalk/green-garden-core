// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plantFromFields } from "../src/drafts.ts";

describe("plantFromFields placement", () => {
  it("an outdoor placement chip is saved on the plant", () => {
    assert.equal(
      plantFromFields({ plantName: "A", placement: "ground" }, undefined).placement,
      "ground",
    );
    assert.equal(
      plantFromFields({ plantName: "A", placement: "outdoor_pot" }, undefined).placement,
      "outdoor_pot",
    );
  });

  it("indoors, an empty field or an unknown value leave placement unset, as before", () => {
    for (const placement of ["indoor", "", "nonsense", undefined]) {
      const f = placement === undefined ? { plantName: "A" } : { plantName: "A", placement };
      assert.equal("placement" in plantFromFields(f, undefined), false);
    }
  });
});
