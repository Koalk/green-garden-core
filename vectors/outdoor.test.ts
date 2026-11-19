// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  computeWindows,
  planDays,
  resolveCare,
  type ClimateClass,
  type PlanInput,
  type PlantInput,
} from "@green-garden/engine";
import { loadVectors, runVector } from "./runner.ts";

// Worked examples E1 to E7 and GV-K1 to GV-K14. Constants are PROVISIONAL.

const lavender: PlantInput = {
  id: "lavender",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "ground",
  sun: "full_sun",
  groundSoil: "loam",
  plantedOn: "2026-05-01",
  establishmentSeasons: 1,
  droughtTolerance: "high",
  establishingIntervalDays: 7,
  lastWatered: "2026-06-01",
};

function without(p: PlantInput, key: keyof PlantInput): PlantInput {
  return Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) as unknown as PlantInput;
}

function windowOf(input: PlanInput, id: string): { earliest: string; latest: string } {
  const w = computeWindows(input).windows.find((x) => x.plantId === id);
  assert.ok(w, `window for ${id}`);
  return { earliest: w.earliest, latest: w.latest };
}

const june = (plant: PlantInput, today = "2026-06-05"): PlanInput => ({
  today,
  climate: "oceanic_dry",
  plants: [plant],
});

describe("GV-K1 and GV-K2: indoor plans are byte-identical to before outdoor care", () => {
  const before = JSON.parse(
    readFileSync(new URL("./snapshots/pre-s161.json", import.meta.url), "utf8"),
  ) as Record<string, Record<string, unknown>>;
  /** The lists added; they are empty for indoor plants. */
  const added = ["rainFed", "dormant", "rainForecastFor"];
  const strip = (r: unknown): unknown => {
    if (Array.isArray(r) || r === null || typeof r !== "object") return r;
    const all = r as Record<string, unknown>;
    for (const k of added) {
      if (k in all) assert.deepEqual(all[k], [], `${k} must be empty for indoor plants`);
    }
    return Object.fromEntries(Object.entries(all).filter(([k]) => !added.includes(k)));
  };
  const decorate = (v: unknown): unknown => {
    const i = v as { plants?: PlantInput[] } | null;
    if (typeof i !== "object" || i === null || !Array.isArray(i.plants)) return v;
    return {
      ...i,
      climate: "arid",
      weather: [{ date: "2026-11-01", rainMm: 40 }],
      plants: i.plants.map((p) => ({
        ...p,
        placement: "indoor",
        sun: "full_sun",
        groundSoil: "sandy",
        mulched: true,
        sheltered: false,
        plantedOn: "2026-10-01",
        establishmentSeasons: 3,
        rootDepth: "deep",
        droughtTolerance: "high",
        dormancy: "summer",
        establishingIntervalDays: 3,
      })),
    };
  };
  // Only vectors that existed before have a snapshot.
  for (const v of loadVectors().filter((x) => x.name in before)) {
    it(`${v.name}: new fields absent`, () => {
      assert.deepEqual(strip(runVector(v)), before[v.name]);
    });
    it(`${v.name}: placement indoor with every new field set`, () => {
      assert.deepEqual(strip(runVector({ ...v, input: decorate(v.input) })), before[v.name]);
    });
  }
});

describe("resolveCare: the modes of 3.2", () => {
  const env = { climate: "mediterranean" as ClimateClass, hemisphere: "north" as const };
  it("returns indoor values unchanged", () => {
    const r = resolveCare({ id: "x", style: "let_top_dry", intervalDays: 9 }, "2026-07-01", env);
    assert.equal(r.mode, "interval");
    assert.equal(r.intervalDays, 9);
    assert.equal(r.creditMm, 0);
    assert.deepEqual(r.assumed, []);
  });
  it("GV-K11 / E4: pot outside, Seville, July", () => {
    const pot: PlantInput = {
      id: "geranium",
      style: "let_top_dry",
      intervalDays: 8,
      placement: "outdoor_pot",
      sun: "full_sun",
      lastWatered: "2026-07-01",
    };
    assert.equal(resolveCare(pot, "2026-07-02", env).intervalDays, 3);
    assert.deepEqual(
      windowOf({ today: "2026-07-02", climate: "mediterranean", plants: [pot] }, "geranium"),
      { earliest: "2026-07-03", latest: "2026-07-05" },
    );
    // part shade on the same balcony: round(8 x 0.7 x 0.7) = 4
    assert.equal(resolveCare({ ...pot, sun: "part_shade" }, "2026-07-02", env).intervalDays, 4);
  });
  it("E5: the climate multiplier stops outside the dry season", () => {
    const pot: PlantInput = {
      id: "g",
      style: "let_top_dry",
      intervalDays: 8,
      placement: "outdoor_pot",
      sun: "full_sun",
    };
    assert.equal(resolveCare(pot, "2026-01-15", env).intervalDays, 4);
  });
  it("pot summer multiplier per class (8.4), part shade, base 10", () => {
    const pot: PlantInput = {
      id: "p",
      style: "let_top_dry",
      intervalDays: 10,
      placement: "outdoor_pot",
      sun: "part_shade",
    };
    const want: Record<ClimateClass, number> = {
      oceanic_wet: 7,
      oceanic_dry: 6, // 6.3
      med_mild: 6, // 5.95
      mediterranean: 5, // 4.9
      semi_arid: 5, // 4.55
      arid: 4, // 4.2
      mountain: 6, // 6.3
    };
    for (const [climate, days] of Object.entries(want)) {
      const e = { climate: climate as ClimateClass, hemisphere: "north" as const };
      assert.equal(resolveCare(pot, "2026-07-15", e).intervalDays, days, climate);
    }
  });
  it("the dry season moves six months in the south", () => {
    const pot: PlantInput = {
      id: "p",
      style: "let_top_dry",
      intervalDays: 10,
      placement: "outdoor_pot",
      sun: "part_shade",
    };
    const south = { climate: "mediterranean" as ClimateClass, hemisphere: "south" as const };
    assert.equal(resolveCare(pot, "2026-07-15", south).intervalDays, 7);
    assert.equal(resolveCare(pot, "2026-01-15", south).intervalDays, 5);
  });
  it("E7: established, tolerance none, hydrangea in clay", () => {
    const h: PlantInput = {
      id: "h",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "ground",
      groundSoil: "clay",
      sun: "part_shade",
      plantedOn: "2020-01-01",
      droughtTolerance: "none",
      establishingIntervalDays: 7,
    };
    assert.equal(resolveCare(h, "2026-07-15", env).intervalDays, 14);
    const four = resolveCare({ ...h, establishingIntervalDays: 4 }, "2026-07-15", env);
    assert.equal(four.intervalDays, 8);
  });
  it("established, tolerance moderate: rain-fed where it rains, else the dry season only", () => {
    const m: PlantInput = {
      id: "m",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "ground",
      plantedOn: "2020-01-01",
      droughtTolerance: "moderate",
      establishingIntervalDays: 7,
    };
    const wet = { climate: "oceanic_wet" as ClimateClass, hemisphere: "north" as const };
    const hills = { climate: "mountain" as ClimateClass, hemisphere: "north" as const };
    assert.equal(resolveCare(m, "2026-07-15", wet).mode, "rain_fed");
    assert.equal(resolveCare(m, "2026-07-15", hills).mode, "rain_fed");
    const dry = resolveCare(m, "2026-07-15", env);
    assert.equal(dry.mode, "interval");
    assert.equal(dry.intervalDays, 14);
    assert.equal(resolveCare(m, "2026-04-15", env).mode, "suspended");
  });
  it("GV-K12: phase flips on the boundary day (planted 2026-05-01, 40 degrees north)", () => {
    const e40 = {
      climate: "oceanic_wet" as ClimateClass,
      hemisphere: "north" as const,
      latitude: 40,
    };
    const one: PlantInput = { ...without(lavender, "lastWatered"), establishmentSeasons: 1 };
    // Full rest starts on 2026-11-30 at 40 degrees: the first growth season is over that day.
    assert.equal(resolveCare(one, "2026-11-29", e40).phase, "establishing");
    assert.equal(resolveCare(one, "2026-11-30", e40).phase, "established");
    const two: PlantInput = { ...one, establishmentSeasons: 2 };
    assert.equal(resolveCare(two, "2027-05-01", e40).phase, "establishing");
    assert.equal(resolveCare(two, "2027-11-29", e40).phase, "establishing");
    assert.equal(resolveCare(two, "2027-11-30", e40).phase, "established");
  });
  it("GV-K14: missing catalogue fields fall back and say so", () => {
    const bare: PlantInput = {
      id: "bare",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "ground",
      plantedOn: "2026-05-01",
    };
    const r = resolveCare(bare, "2026-07-15", env);
    assert.equal(r.mode, "interval");
    assert.equal(r.intervalDays, 7);
    for (const f of ["droughtTolerance", "rootDepth", "establishingIntervalDays"]) {
      assert.ok(r.assumed.includes(f), f);
    }
    const old = resolveCare(without(bare, "plantedOn"), "2026-07-15", env);
    assert.equal(old.phase, "established");
    assert.ok(old.assumed.includes("phase"));
    assert.equal(old.creditMm, 15);
  });
  it("credit tiers: root depth, phase, pot, shelter", () => {
    const g = (p: Partial<PlantInput>): number =>
      resolveCare({ id: "c", style: "let_top_dry", intervalDays: 7, ...p }, "2026-06-05", env)
        .creditMm;
    const old = { placement: "ground" as const, plantedOn: "2020-01-01" };
    assert.equal(g({ ...old, rootDepth: "shallow" }), 10);
    assert.equal(g({ ...old, rootDepth: "medium" }), 15);
    assert.equal(g({ ...old, rootDepth: "deep" }), 20);
    const young = { placement: "ground" as const, plantedOn: "2026-05-01" };
    assert.equal(g({ ...young, rootDepth: "shallow" }), 15);
    assert.equal(g({ ...young, rootDepth: "deep" }), 20);
    assert.equal(g({ placement: "outdoor_pot" }), 8);
    assert.equal(g({ placement: "outdoor_pot", sheltered: true }), 0);
    assert.equal(g({ ...old, sheltered: true }), 0);
  });
});

describe("GV-K3 to GV-K7: rain credit", () => {
  const e2: PlantInput = { ...lavender, droughtTolerance: "moderate" };
  it("GV-K3 / E2: interval 6, a full credit moves the window", () => {
    const plain = windowOf(june(e2), "lavender");
    assert.deepEqual(plain, { earliest: "2026-06-05", latest: "2026-06-09" });
    const rained = windowOf(
      june({ ...e2, logs: [{ date: "2026-06-04", outcome: "rain", mm: 18 }] }),
      "lavender",
    );
    assert.deepEqual(rained, { earliest: "2026-06-11", latest: "2026-06-12" });
  });
  it("GV-K4 / E3: interval 5, a partial credit leaves the window, sets notBefore", () => {
    const e3: PlantInput = { ...e2, groundSoil: "sandy", mulched: true };
    const base = june(e3, "2026-06-04");
    assert.deepEqual(windowOf(base, "lavender"), { earliest: "2026-06-05", latest: "2026-06-07" });
    const partial = june(
      { ...e3, logs: [{ date: "2026-06-03", outcome: "rain", mm: 9 }] },
      "2026-06-04",
    );
    assert.deepEqual(windowOf(partial, "lavender"), {
      earliest: "2026-06-05",
      latest: "2026-06-07",
    });
    // A partial on the day the window opens pushes the start one day.
    const onDay = june(
      { ...e3, logs: [{ date: "2026-06-05", outcome: "rain", mm: 9 }] },
      "2026-06-05",
    );
    assert.deepEqual(windowOf(onDay, "lavender"), { earliest: "2026-06-06", latest: "2026-06-07" });
    // Below half the credit nothing happens.
    const light = june(
      { ...e3, logs: [{ date: "2026-06-05", outcome: "rain", mm: 5 }] },
      "2026-06-05",
    );
    assert.deepEqual(windowOf(light, "lavender"), { earliest: "2026-06-05", latest: "2026-06-07" });
  });
  it("GV-K5: a credit does not touch the learned adjustment", () => {
    const learned: PlantInput = {
      ...lavender,
      droughtTolerance: "moderate",
      sun: "part_shade",
      adjustmentDays: 2,
      doneStreak: 2,
      lastWatered: "2026-06-01",
      logs: [{ date: "2026-06-05", outcome: "rain", mm: 20 }],
    };
    // interval 7 + 2 = 9, let_top_dry band 7 to 11 from the rain day
    assert.deepEqual(windowOf(june(learned, "2026-06-06"), "lavender"), {
      earliest: "2026-06-12",
      latest: "2026-06-16",
    });
  });
  it("GV-K6: two partial rains on consecutive days make one full credit", () => {
    const logs = [
      { date: "2026-06-03", outcome: "rain" as const, mm: 8 },
      { date: "2026-06-04", outcome: "rain" as const, mm: 8 },
    ];
    assert.deepEqual(windowOf(june({ ...e2, logs }), "lavender"), {
      earliest: "2026-06-11",
      latest: "2026-06-12",
    });
    // two days apart they do not sum
    const apart = [
      { date: "2026-06-02", outcome: "rain" as const, mm: 8 },
      { date: "2026-06-04", outcome: "rain" as const, mm: 8 },
    ];
    assert.deepEqual(windowOf(june({ ...e2, logs: apart }), "lavender"), {
      earliest: "2026-06-05",
      latest: "2026-06-09",
    });
  });
  it("GV-K7: sheltered and indoor plants ignore rain", () => {
    const rain = [{ date: "2026-06-04", outcome: "rain" as const, mm: 40 }];
    const plain = windowOf(june(e2), "lavender");
    assert.deepEqual(windowOf(june({ ...e2, sheltered: true, logs: rain }), "lavender"), plain);
    const indoor: PlantInput = {
      id: "i",
      style: "let_top_dry",
      intervalDays: 6,
      lastWatered: "2026-06-01",
    };
    assert.deepEqual(windowOf(june({ ...indoor, logs: rain }), "i"), windowOf(june(indoor), "i"));
  });
  it("observed weather rows credit like rain logs; forecast rows do not", () => {
    const observed = windowOf(
      { ...june(e2), weather: [{ date: "2026-06-04", rainMm: 18 }] },
      "lavender",
    );
    assert.deepEqual(observed, { earliest: "2026-06-11", latest: "2026-06-12" });
    const forecast = windowOf(
      { ...june(e2), weather: [{ date: "2026-06-04", rainMm: 18, forecast: true }] },
      "lavender",
    );
    assert.deepEqual(forecast, { earliest: "2026-06-05", latest: "2026-06-09" });
  });
  it("rain before the last watering is ignored", () => {
    const old = [{ date: "2026-05-20", outcome: "rain" as const, mm: 40 }];
    assert.deepEqual(windowOf(june({ ...e2, logs: old }), "lavender"), {
      earliest: "2026-06-05",
      latest: "2026-06-09",
    });
  });
});

describe("GV-K8 to GV-K10: rain-fed and dormant plants", () => {
  const med = {
    today: "2026-07-20",
    climate: "mediterranean" as ClimateClass,
    hemisphere: "north" as const,
  };
  const established: PlantInput = { ...without(lavender, "lastWatered"), plantedOn: "2023-03-01" };
  const check = (extra: Partial<PlanInput> = {}, logs: PlantInput["logs"] = []) => {
    const entry = planDays({ ...med, ...extra, plants: [{ ...established, logs }] }).rainFed[0];
    assert.ok(entry, "the plant is rain-fed");
    return entry;
  };

  it("GV-K8 / E1: rain-fed means no window and no watering day", () => {
    const input: PlanInput = { ...med, plants: [established] };
    const plan = planDays(input);
    assert.deepEqual(plan.days, []);
    assert.deepEqual(plan.plants, []);
    assert.deepEqual(computeWindows(input).windows, []);
    assert.deepEqual(
      plan.rainFed.map((r) => r.plantId),
      ["lavender"],
    );
    assert.deepEqual(
      computeWindows(input).rainFed.map((r) => r.plantId),
      ["lavender"],
    );
  });
  it("GV-K9: drought check after the climate's days without a credit", () => {
    // mediterranean: 21 days. No record at all: counted from nothing, no prompt.
    const none = check();
    assert.equal(none.droughtCheck, false);
    assert.equal(none.daysSinceCredit, null);
    assert.equal(none.checkDays, 21);
    const looks = check({}, [{ date: "2026-06-25", outcome: "looks_fine" }]);
    assert.equal(looks.daysSinceCredit, 25);
    assert.equal(looks.droughtCheck, true);
    assert.equal(check({}, [{ date: "2026-07-10", outcome: "looks_fine" }]).droughtCheck, false);
    const watered = check({}, [
      { date: "2026-06-01", outcome: "done" },
      { date: "2026-07-05", outcome: "rain", mm: 20 },
    ]);
    assert.equal(watered.daysSinceCredit, 15);
    // a partial rain is not a credit
    const partial = check({}, [
      { date: "2026-06-25", outcome: "looks_fine" },
      { date: "2026-07-18", outcome: "rain", mm: 9 },
    ]);
    assert.equal(partial.daysSinceCredit, 25);
    // observed weather credits too
    const observed = check(
      {
        weather: [
          { date: "2026-07-10", rainMm: 14.9 },
          { date: "2026-07-12", rainMm: 15 },
        ],
      },
      [{ date: "2026-06-25", outcome: "looks_fine" }],
    );
    assert.equal(observed.daysSinceCredit, 8);
    // wet climates wait longer
    const wet = check({ climate: "oceanic_wet" }, [{ date: "2026-06-25", outcome: "looks_fine" }]);
    assert.equal(wet.checkDays, 28);
    assert.equal(wet.droughtCheck, false);
  });
  it("GV-K10: the dormant season suspends ground plants and says when it ends", () => {
    const h: PlantInput = { ...established, droughtTolerance: "none", sun: "part_shade" };
    const plan = planDays({ today: "2027-01-10", climate: "oceanic_dry", plants: [h] });
    assert.deepEqual(plan.plants, []);
    assert.equal(plan.dormant.length, 1);
    assert.equal(plan.dormant[0]?.plantId, "lavender");
    assert.equal(plan.dormant[0].until, "2027-03-02");
    assert.equal(computeWindows({ today: "2027-01-10", plants: [h] }).dormant.length, 1);
    // summer dormancy: July and August
    const bulb: PlantInput = { ...h, dormancy: "summer" };
    const july = planDays({ today: "2026-07-10", climate: "mediterranean", plants: [bulb] });
    assert.equal(july.dormant[0]?.until, "2026-09-01");
    const sept = planDays({ today: "2026-09-10", climate: "mediterranean", plants: [bulb] });
    assert.equal(sept.dormant.length, 0);
  });
  it("the winter soak prompt: evergreens and new plantings, after 28 dry days", () => {
    const ev: PlantInput = { ...established, droughtTolerance: "none", dormancy: "none" };
    const jan = { today: "2027-01-10", climate: "oceanic_dry" as ClimateClass };
    const soak = (p: PlantInput): boolean | undefined =>
      planDays({ ...jan, plants: [p] }).dormant[0]?.winterSoak;
    assert.equal(soak({ ...ev, logs: [{ date: "2026-12-01", outcome: "looks_fine" }] }), true);
    assert.equal(soak({ ...ev, logs: [{ date: "2026-12-20", outcome: "looks_fine" }] }), false);
    const deciduous: PlantInput = {
      ...ev,
      dormancy: "winter",
      logs: [{ date: "2026-12-01", outcome: "looks_fine" }],
    };
    assert.equal(soak(deciduous), false);
    assert.equal(soak({ ...deciduous, plantedOn: "2026-10-01" }), true);
  });
});

describe("GV-K13: forecast rain is a hint, never a change", () => {
  it("the plan is identical with and without forecast rows", () => {
    const base: PlanInput = {
      today: "2026-06-05",
      climate: "oceanic_dry",
      plants: [{ ...lavender, droughtTolerance: "moderate" }],
    };
    const forecast: PlanInput = {
      ...base,
      weather: [{ date: "2026-06-06", rainMm: 25, forecast: true }],
    };
    const a = planDays(base);
    const b = planDays(forecast);
    assert.deepEqual(b.days, a.days);
    assert.deepEqual(b.plants, a.plants);
    assert.deepEqual(a.rainForecastFor, []);
    assert.deepEqual(b.rainForecastFor, ["lavender"]);
  });
});

describe("sheltered ground plants are never rain-fed", () => {
  const settled: PlantInput = { ...lavender, plantedOn: "2025-04-01", mulched: false };
  const env = { climate: "oceanic_dry" as ClimateClass, hemisphere: "north" as const };
  const june5 = "2026-06-05";

  it("an open, settled, drought-tolerant plant stays rain-fed", () => {
    assert.equal(resolveCare(settled, june5, env).mode, "rain_fed");
  });
  it("sheltered + high tolerance: interval, factor 3, creditMm 0", () => {
    const r = resolveCare({ ...settled, sheltered: true }, june5, env);
    assert.equal(r.mode, "interval");
    assert.equal(r.intervalDays, 21); // 3 x establishing 7 x loam 1
    assert.equal(r.creditMm, 0);
  });
  it("sheltered + moderate tolerance: interval, factor 2, even where rain feeds moderate plants", () => {
    const r = resolveCare(
      { ...settled, droughtTolerance: "moderate", sheltered: true },
      june5,
      env,
    );
    assert.equal(r.mode, "interval");
    assert.equal(r.intervalDays, 14);
    const open = resolveCare({ ...settled, droughtTolerance: "moderate" }, june5, env);
    assert.equal(open.mode, "rain_fed");
  });
  it("sheltered + moderate, outside the dry months: dormant, not rain-fed", () => {
    const r = resolveCare(
      { ...settled, droughtTolerance: "moderate", sheltered: true },
      "2026-10-05",
      env,
    );
    assert.equal(r.mode, "suspended");
  });
  it("sheltered + no tolerance keeps its interval row", () => {
    const a = resolveCare({ ...settled, droughtTolerance: "none" }, june5, env);
    const b = resolveCare({ ...settled, droughtTolerance: "none", sheltered: true }, june5, env);
    assert.equal(b.mode, "interval");
    assert.equal(b.intervalDays, a.intervalDays);
  });
  it("establishing and dormant behaviour unchanged by shelter", () => {
    const young = { ...lavender, sheltered: true };
    assert.equal(resolveCare(young, june5, env).phase, "establishing");
    assert.equal(
      resolveCare(young, june5, env).intervalDays,
      resolveCare(lavender, june5, env).intervalDays,
    );
    const winter = resolveCare({ ...settled, sheltered: true }, "2026-01-15", env);
    assert.equal(winter.mode, "suspended");
  });
  it("assumed: sheltered when the flag is unknown outdoors, not when it is set or indoors", () => {
    assert.ok(resolveCare(settled, june5, env).assumed.includes("sheltered"));
    assert.ok(
      !resolveCare({ ...settled, sheltered: false }, june5, env).assumed.includes("sheltered"),
    );
    assert.ok(
      !resolveCare({ ...settled, sheltered: true }, june5, env).assumed.includes("sheltered"),
    );
    const pot: PlantInput = {
      id: "p",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "outdoor_pot",
    };
    assert.ok(resolveCare(pot, june5, env).assumed.includes("sheltered"));
    const indoor: PlantInput = { id: "i", style: "let_top_dry", intervalDays: 7 };
    assert.deepEqual(resolveCare(indoor, june5, env).assumed, []);
  });
  it("a sheltered settled plant is in no rain-fed list and has no drought check", () => {
    const r = planDays(june({ ...settled, sheltered: true }));
    assert.deepEqual(r.rainFed, []);
    const open = planDays(june(settled));
    assert.equal(open.rainFed.length, 1);
  });
  it("no 'rain forecast: you may wait' hint for a sheltered plant, pot or ground", () => {
    const forecast = [{ date: "2026-06-06", rainMm: 25, forecast: true }];
    const pot: PlantInput = {
      id: "pot",
      style: "let_top_dry",
      intervalDays: 3,
      placement: "outdoor_pot",
      lastWatered: "2026-06-01",
    };
    const open = planDays({ ...june(pot), weather: forecast });
    assert.deepEqual(open.rainForecastFor, ["pot"]);
    const shelteredPot = planDays({ ...june({ ...pot, sheltered: true }), weather: forecast });
    assert.deepEqual(shelteredPot.rainForecastFor, []);
    const ground = planDays({
      ...june({ ...settled, droughtTolerance: "none", sheltered: true, lastWatered: "2026-05-01" }),
      weather: forecast,
    });
    assert.deepEqual(ground.rainForecastFor, []);
  });
  it("a rain-fed plant that becomes sheltered switches to an interval on its next plan", () => {
    const before = planDays(june(settled));
    const after = planDays(june({ ...settled, sheltered: true }));
    assert.equal(before.rainFed.length, 1);
    assert.equal(after.rainFed.length, 0);
    assert.ok(after.plants.some((p) => p.plantId === "lavender"));
  });
});
