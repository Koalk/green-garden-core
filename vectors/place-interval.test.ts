// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeInterval, type PlanInput, type PlantInput } from "@green-garden/engine";

// Interval 7 indoors; part_shade pot outside is x0.7 -> 5 (hand-computed, as placement-history.test.ts).
const base: PlantInput = {
  id: "cal",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "indoor",
  sun: "part_shade",
  lastWatered: "2026-10-10",
};
const at = (plant: PlantInput): PlanInput => ({ today: "2026-10-20", plants: [plant] });

describe("placeInterval: the working interval of a plant where it is today", () => {
  it("indoors it is the plant's own interval", () => {
    assert.equal(placeInterval(at(base), "cal"), 7);
  });
  it("in a pot outside it is the pot's exposure interval", () => {
    assert.equal(placeInterval(at({ ...base, placement: "outdoor_pot" }), "cal"), 5);
  });
  it("learned adjustment is not counted: a move starts learning again", () => {
    assert.equal(placeInterval(at({ ...base, adjustmentDays: 2 }), "cal"), 7);
  });
  it("an unknown plant has none", () => {
    assert.equal(placeInterval(at(base), "nope"), undefined);
  });
});
