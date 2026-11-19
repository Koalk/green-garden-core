// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDays } from "@green-garden/engine";

// the reasons name the real cause of a gap.
describe("away reasons", () => {
  it("an old lastWatered with the stretch after the watering reads as overdue, not away", () => {
    const r = planDays({
      today: "2026-11-10",
      horizonDays: 3,
      prefs: { unavailableDates: ["2026-11-12", "2026-11-13"] },
      plants: [{ id: "fern", style: "keep_moist", intervalDays: 4, lastWatered: "2026-10-29" }],
    });
    const p = r.plants.at(0);
    assert.ok(p);
    assert.equal(p.waterings[0]?.date, "2026-11-10");
    assert.deepEqual(p.outlook.reasons, ["gap_exceeds_band"]);
  });

  it("a gap the stretch made that exceeds the tolerance keeps both reasons", () => {
    const r = planDays({
      today: "2026-11-10",
      horizonDays: 14,
      prefs: {
        unavailableDates: Array.from({ length: 10 }, (_, i) => `2026-11-${10 + i}`),
      },
      plants: [{ id: "fern", style: "keep_moist", intervalDays: 4, lastWatered: "2026-11-10" }],
    });
    const p = r.plants.at(0);
    assert.ok(p);
    assert.deepEqual(p.outlook.reasons, ["away_days", "gap_exceeds_band"]);
    assert.equal(p.outlook.level, "decay");
  });

  it("a plant whose interval is longer than the stretch, watered before it, has no warning", () => {
    const r = planDays({
      today: "2026-11-10",
      horizonDays: 20,
      prefs: { unavailableDates: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"] },
      plants: [{ id: "pothos", style: "let_top_dry", intervalDays: 10, lastWatered: "2026-11-10" }],
    });
    assert.equal(r.plants[0]?.outlook.severity, 0);
  });
});
