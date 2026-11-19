// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandTable,
  computeWindows,
  formatDate,
  parseDate,
  planDays,
  weekday,
  type PlanInput,
  type PlantInput,
  type WateringStyle,
} from "@green-garden/engine";

/** Small seeded generator so a failing case can be replayed from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES: readonly WateringStyle[] = ["keep_moist", "let_top_dry", "let_fully_dry"];
const TODAY = "2026-07-06"; // growth season in the north, so no seasonal factor is in play
const TODAY_N = parseDate(TODAY) ?? 0;
const CASES = 300;

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

/** Plants that are not overdue: last watered between 1 and I days ago. */
function randomPlants(r: () => number, count: number): PlantInput[] {
  const plants: PlantInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const style = pick(r, STYLES);
    const intervalDays = style === "keep_moist" ? int(r, 3, 8) : int(r, 5, 30);
    plants.push({
      id: `p${String(i).padStart(2, "0")}`,
      style,
      intervalDays,
      lastWatered: formatDate(TODAY_N - int(r, 1, intervalDays)),
    });
  }
  return plants;
}

function shuffle<T>(r: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("engine properties (seeded)", () => {
  it("is deterministic and independent of plant order", () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const plants = randomPlants(r, int(r, 1, 12));
      const input: PlanInput = { today: TODAY, horizonDays: 28, plants };
      const a = planDays(input);
      assert.deepEqual(planDays(input), a, `seed ${seed}`);
      assert.deepEqual(planDays({ ...input, plants: shuffle(r, plants) }), a, `seed ${seed}`);
    }
  });

  it("adding a plant never changes another plant's window", () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const plants = randomPlants(r, int(r, 2, 10));
      const extra = plants.slice(1);
      const withAll = computeWindows({ today: TODAY, plants }).windows;
      const without = computeWindows({ today: TODAY, plants: extra }).windows;
      for (const w of without) {
        assert.deepEqual(
          withAll.find((x) => x.plantId === w.plantId),
          w,
          `seed ${seed}`,
        );
      }
    }
  });

  it("without away days every gap stays inside the band and no plant is watered more than ideal", () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const plants = randomPlants(r, int(r, 1, 12));
      const plan = planDays({ today: TODAY, horizonDays: 28, plants });
      for (const p of plan.plants) {
        const cfg = plants.find((x) => x.id === p.plantId) as PlantInput;
        const [b] = bandTable([{ style: cfg.style, intervalDays: cfg.intervalDays }]);
        assert.ok(b, "band");
        let prev = parseDate(cfg.lastWatered ?? "") ?? 0;
        for (const w of p.waterings) {
          const day = parseDate(w.date) ?? 0;
          const gap = day - prev;
          assert.ok(
            gap >= b.low && gap <= b.high,
            `seed ${seed} ${p.plantId} gap ${gap} band [${b.low},${b.high}]`,
          );
          prev = day;
        }
        assert.ok(p.wateringCount <= p.idealCount + 1, `seed ${seed} ${p.plantId} count`);
        assert.ok(p.wateringCount >= p.idealCount - 1, `seed ${seed} ${p.plantId} count`);
        assert.equal(p.outlook.level, "thrive", `seed ${seed} ${p.plantId}`);
      }
    }
  });

  it("combining never needs more days than watering every plant on its own ideal days", () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const plan = planDays({
        today: TODAY,
        horizonDays: 28,
        plants: randomPlants(r, int(r, 1, 12)),
      });
      assert.ok(plan.summary.wateringDays <= plan.summary.naiveDays, `seed ${seed}`);
    }
  });

  it("every watering is inside its window or the plant carries a warning", () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const plants = randomPlants(r, int(r, 1, 10));
      const unavailableDates: string[] = [];
      for (let k = 0; k < int(r, 0, 14); k += 1)
        unavailableDates.push(formatDate(TODAY_N + int(r, 0, 27)));
      const unavailableWeekdays = r() < 0.4 ? [int(r, 0, 6), int(r, 0, 6)] : [];
      const preLeaveWatering = r() < 0.5;
      const plan = planDays({
        today: TODAY,
        horizonDays: 28,
        plants,
        prefs: { unavailableDates, unavailableWeekdays, preLeaveWatering },
      });
      for (const d of plan.days) {
        assert.ok(
          !unavailableDates.includes(d.date),
          `seed ${seed} planned on away date ${d.date}`,
        );
        assert.ok(
          !unavailableWeekdays.includes(weekday(parseDate(d.date) ?? 0)),
          `seed ${seed} planned on unavailable weekday ${d.date}`,
        );
      }
      const windows = computeWindows({ today: TODAY, plants }).windows;
      for (const p of plan.plants) {
        const w = windows.find((x) => x.plantId === p.plantId);
        if (
          w !== undefined &&
          (parseDate(w.latest) ?? 0) <= TODAY_N + 27 &&
          p.wateringCount === 0
        ) {
          assert.ok(p.outlook.severity > 0, `seed ${seed} ${p.plantId} unserved without warning`);
        }
        // A pre-leave watering is outside the window on purpose, within the wet tolerance.
        // a late watering the away days caused, inside the dry tolerance, carries no warning.
        const outside = p.waterings.some(
          (w) => !w.inWindow && w.reason !== "pre_leave" && w.reason !== "away_days",
        );
        if (outside) {
          assert.ok(
            p.outlook.severity > 0,
            `seed ${seed} ${p.plantId} outside window without warning`,
          );
        }
        const warned = p.outlook.severity > 0;
        if (warned)
          assert.ok(
            p.outlook.reasons.length > 0,
            `seed ${seed} ${p.plantId} warning without reason`,
          );
      }
    }
  });
});
