// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWindows,
  formatDate,
  parseDate,
  planDays,
  restWeight,
  type Hemisphere,
  type PlantInput,
} from "@green-garden/engine";

const day = (s: string): number => {
  const d = parseDate(s);
  assert.ok(d !== undefined, s);
  return d;
};

/** Every date of a year, as day numbers. */
function year(y: number): number[] {
  const start = day(`${String(y)}-01-01`);
  return Array.from({ length: 365 }, (_, i) => start + i);
}

describe("rest season ramp", () => {
  it("is always between 0 and 1 and moves by at most 1/30 a day, so there is no switch day", () => {
    for (const hemisphere of ["north", "south"] as const)
      for (const latitude of [31, 40, 48, 55, 62, 70]) {
        const days = year(2026);
        for (const [i, d] of days.entries()) {
          const w = restWeight(d, hemisphere, latitude);
          assert.ok(w >= 0 && w <= 1, `${formatDate(d)} ${String(w)}`);
          const prev = days[i - 1];
          if (prev !== undefined) {
            const step = Math.abs(w - restWeight(prev, hemisphere, latitude));
            assert.ok(step <= 1 / 30 + 1e-9, `${formatDate(d)} jumps by ${String(step)}`);
          }
        }
      }
  });

  it("starts earlier and lasts longer the further from the equator (UK against Spain)", () => {
    const total = (lat: number): number =>
      year(2026).reduce((sum, d) => sum + restWeight(d, "north", lat), 0);
    assert.ok(total(55) > total(40) + 30, `${String(total(55))} vs ${String(total(40))}`);
    assert.ok(total(40) > total(35));
    // the UK is already half way up on a date when Spain has not started
    assert.equal(restWeight(day("2026-10-17"), "north", 55), 0.5);
    assert.equal(restWeight(day("2026-10-17"), "north", 40), 0);
  });

  it("the southern hemisphere is the north half a year later", () => {
    for (let d = day("2026-01-01"); d < day("2026-07-01"); d += 7) {
      const north = restWeight(d, "north", 50);
      const south = restWeight(d + 182, "south", 50);
      assert.ok(Math.abs(north - south) <= 1 / 30 + 1e-9, formatDate(d));
    }
    assert.equal(restWeight(day("2026-12-31"), "south", 55), 0);
    assert.equal(restWeight(day("2026-07-01"), "south", 55), 1);
  });

  it("the sign of a latitude does not matter: the hemisphere says which side", () => {
    assert.equal(
      restWeight(day("2026-10-17"), "north", -55),
      restWeight(day("2026-10-17"), "north", 55),
    );
  });

  it("junk latitudes fall back to the default for the hemisphere", () => {
    const dflt = restWeight(day("2026-10-17"), "north");
    assert.equal(restWeight(day("2026-10-17"), "north", Number.NaN), dflt);
    assert.equal(
      restWeight(day("2026-10-17"), "north", 200),
      restWeight(day("2026-10-17"), "north", 90),
    );
  });
});

describe("the ramp in the windows", () => {
  const pothos: PlantInput = {
    id: "pothos",
    style: "let_top_dry",
    intervalDays: 7,
    restFactor: 1.5,
  };
  const latest = (watered: string, hemisphere: Hemisphere, latitude: number): string => {
    const r = computeWindows({
      today: watered,
      hemisphere,
      latitude,
      plants: [{ ...pothos, lastWatered: watered }],
    });
    const w = r.windows[0];
    assert.ok(w);
    return w.latest;
  };

  it("an interval inside the ramp lies between the two ends and never goes down on the way in", () => {
    let previous = 0;
    for (let d = day("2026-09-20"); d <= day("2026-11-10"); d++) {
      const watered = formatDate(d);
      const gap = day(latest(watered, "north", 55)) - d;
      assert.ok(gap >= 9 && gap <= 14, `${watered} gap ${String(gap)}`); // 7+2 .. 11+3 (band late)
      assert.ok(gap >= previous - 1, `${watered} fell from ${String(previous)} to ${String(gap)}`);
      previous = gap;
    }
  });

  it("the plan lays waterings with the ramped interval (no hard switch on 1 November)", () => {
    const r = planDays({
      today: "2026-10-01",
      hemisphere: "north",
      latitude: 55,
      horizonDays: 60,
      plants: [{ ...pothos, lastWatered: "2026-10-01" }],
    });
    const dates = r.plants[0]?.waterings.map((w) => day(w.date)) ?? [];
    const gaps = dates.slice(1).map((d, i) => d - (dates[i] ?? 0));
    assert.ok(gaps.length >= 3);
    for (let i = 1; i < gaps.length; i++)
      assert.ok((gaps[i] ?? 0) >= (gaps[i - 1] ?? 0) - 1, `gaps ${gaps.join(",")}`);
    assert.ok((gaps.at(-1) ?? 0) > (gaps[0] ?? 0), `gaps ${gaps.join(",")}`);
  });

  it("a plant without a rest factor never changes", () => {
    const plain: PlantInput = {
      id: "p",
      style: "let_top_dry",
      intervalDays: 7,
      lastWatered: "2026-12-01",
    };
    const a = computeWindows({ today: "2026-12-02", latitude: 55, plants: [plain] });
    assert.equal(a.windows[0]?.earliest, "2026-12-06");
  });
});
