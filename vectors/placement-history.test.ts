// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWindows,
  creditMmOn,
  parseDate,
  placementOn,
  planDays,
  recordMove,
  type PlanInput,
  type PlantInput,
  type WeatherDay,
} from "@green-garden/engine";

// (dated history; learning
// restarts on a move). Hand-computed with interval 7 indoors, part_shade pot (x0.7 -> 5 days), let_top_dry
// (band 25 % / 25 % -> 1 day early, 1 day late at interval 5), oceanic_wet, no rest factor.

const calamondin: PlantInput = {
  id: "cal",
  style: "let_top_dry",
  intervalDays: 7,
  placement: "outdoor_pot",
  sun: "part_shade",
  lastWatered: "2026-10-10",
  placementHistory: [
    { on: "2026-01-01", placement: "indoor" },
    { on: "2026-10-15", placement: "outdoor_pot" },
  ],
};

const without = (p: PlantInput, key: keyof PlantInput): PlantInput =>
  Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) as unknown as PlantInput;

const rain = (date: string, rainMm: number): WeatherDay => ({ date, rainMm });
const input = (today: string, plant: PlantInput, weather: WeatherDay[] = []): PlanInput => ({
  today,
  plants: [plant],
  weather,
});
const windowOf = (i: PlanInput, id = "cal") => {
  const w = computeWindows(i).windows.find((x) => x.plantId === id);
  assert.ok(w, `window for ${id}`);
  return w;
};

describe("placementOn and creditMmOn", () => {
  it("the last entry on or before the day wins; the first entry reaches back", () => {
    assert.deepEqual(placementOn(calamondin, parseDate("2026-10-14") ?? 0), {
      placement: "indoor",
      sheltered: false,
    });
    assert.equal(placementOn(calamondin, parseDate("2026-10-15") ?? 0).placement, "outdoor_pot");
    assert.equal(placementOn(calamondin, parseDate("2020-01-01") ?? 0).placement, "indoor");
  });
  it("without a history the plant's own fields hold for every day", () => {
    const plain = without(calamondin, "placementHistory");
    assert.equal(placementOn(plain, parseDate("2020-01-01") ?? 0).placement, "outdoor_pot");
  });
  it("credit is 0 indoors and under cover, the pot credit in the open", () => {
    const d = (s: string) => parseDate(s) ?? 0;
    assert.equal(creditMmOn(calamondin, d("2026-10-14")), 0);
    assert.equal(creditMmOn(calamondin, d("2026-10-16")), 8);
    const covered: PlantInput = {
      ...calamondin,
      placementHistory: [
        { on: "2026-01-01", placement: "indoor" },
        { on: "2026-10-15", placement: "outdoor_pot", sheltered: true },
      ],
    };
    assert.equal(creditMmOn(covered, d("2026-10-16")), 0);
  });
});

describe("rain credit follows where the plant was", () => {
  it("rain that fell while it was indoors is not a watering", () => {
    // Earlier bug: 12 mm on 12 Oct moved the last watering to 12 Oct (window 16 to 18 Oct).
    // Indoors on 12 Oct: ignored. Moved out 15 Oct: anchor 10 Oct + 5 = 15 Oct, window 14 to 16.
    const w = windowOf(input("2026-10-16", calamondin, [rain("2026-10-12", 12)]));
    assert.deepEqual([w.earliest, w.latest, w.overdueDays], ["2026-10-16", "2026-10-16", 0]);
  });
  it("rain that fell after the move counts in full", () => {
    // 12 mm on 17 Oct >= 8: last 17 Oct, anchor 15 + 5 = 20 Oct; interval 5: window 19 to 21, band 21 to 23.
    const w = windowOf(input("2026-10-18", calamondin, [rain("2026-10-17", 12)]));
    assert.deepEqual([w.earliest, w.latest], ["2026-10-21", "2026-10-21"]);
  });
  it("brought in on 15 October: no credit after it, the interval switches that day", () => {
    const home: PlantInput = {
      id: "cal",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "indoor",
      sun: "part_shade",
      lastWatered: "2026-10-10",
      placementHistory: [
        { on: "2026-01-01", placement: "outdoor_pot" },
        { on: "2026-10-15", placement: "indoor" },
      ],
    };
    // 12 mm on 13 Oct (outdoors): a full watering, last 13 Oct. Rain on 17 Oct (indoors): nothing.
    // Moved in 15 Oct: interval 7, anchor 13 + 7 = 20 Oct. Band 7 -> early 2, late 2: window 18 to 22, band 18 to 22.
    const w = windowOf(input("2026-10-18", home, [rain("2026-10-13", 12), rain("2026-10-17", 30)]));
    assert.deepEqual([w.earliest, w.latest], ["2026-10-18", "2026-10-22"]);
  });
  it("a partial rain indoors does not add to one outdoors", () => {
    const w = windowOf(
      input("2026-10-16", calamondin, [rain("2026-10-14", 5), rain("2026-10-15", 5)]),
    );
    // 14 Oct indoors: dropped; 15 Oct 5 mm alone is half the credit (4 mm) or more: snooze only.
    assert.equal(w.latest, "2026-10-16");
  });
});

describe("a move restarts learning and re-anchors", () => {
  const learned: PlantInput = {
    id: "cal",
    style: "let_top_dry",
    intervalDays: 7,
    placement: "outdoor_pot",
    sun: "part_shade",
    lastWatered: "2026-10-01",
    adjustmentDays: 2,
    doneStreak: 1,
    placementHistory: [
      { on: "2026-01-01", placement: "indoor" },
      { on: "2026-10-05", placement: "outdoor_pot" },
    ],
  };
  it("adjustment and streak go to 0, anchor = last watering + the new place's interval", () => {
    // Without the fold: interval 5 + 2 = 7, window 6 to 10 Oct. With it: interval 5, anchor 6 Oct, window 5 to 7 Oct.
    const w = windowOf(input("2026-10-05", learned));
    assert.deepEqual([w.earliest, w.latest], ["2026-10-05", "2026-10-07"]);
  });
  it("a move dated in the past re-plans from that date, with later logs on top", () => {
    const logged: PlantInput = { ...learned, logs: [{ date: "2026-10-08", outcome: "done" }] };
    // Moved 5 Oct: anchor 6 Oct. Done 8 Oct: anchor 11 Oct, last 8 Oct: window 12 to 12 Oct (band 12 to 14).
    const w = windowOf(input("2026-10-10", logged));
    assert.deepEqual([w.earliest, w.latest], ["2026-10-12", "2026-10-12"]);
  });
  it("a move dated in the future is not part of the story yet", () => {
    const later: PlantInput = {
      ...learned,
      placement: "indoor",
      placementHistory: [
        { on: "2026-01-01", placement: "outdoor_pot" },
        { on: "2026-10-20", placement: "indoor" },
      ],
    };
    // Today 10 Oct: still the outdoor pot (interval 5 + adjustment 2); the learned numbers are untouched.
    const w = windowOf(input("2026-10-10", { ...later, placement: "outdoor_pot" }));
    const kept = windowOf(
      input("2026-10-10", without({ ...later, placement: "outdoor_pot" }, "placementHistory")),
    );
    assert.deepEqual([w.earliest, w.latest], [kept.earliest, kept.latest]);
  });
  it("a plant never watered stays due today after a move", () => {
    const never = without(learned, "lastWatered");
    const w = windowOf(input("2026-10-06", never));
    assert.equal(w.earliest, "2026-10-06");
  });
});

describe("justMoved", () => {
  it("is set for 3 days after a move while a window is open, else absent", () => {
    const base = { ...calamondin, lastWatered: "2026-10-10" };
    assert.equal(windowOf(input("2026-10-16", base)).justMoved, true);
    assert.equal(windowOf(input("2026-10-18", base)).justMoved, true);
    assert.equal(windowOf(input("2026-10-19", base)).justMoved, undefined);
    assert.equal(windowOf(input("2026-10-14", base)).justMoved, undefined);
  });
  it("is absent when the window is not open yet", () => {
    const fresh = { ...calamondin, lastWatered: "2026-10-15" };
    assert.equal(windowOf(input("2026-10-16", fresh)).justMoved, undefined);
  });
  it("plans carry it too", () => {
    const p = planDays(input("2026-10-16", calamondin)).plants.find((x) => x.plantId === "cal");
    assert.equal(p?.justMoved, true);
  });
});

describe("a plant with no history, or one base entry, plans exactly as before", () => {
  const weather = [rain("2026-06-02", 12), rain("2026-06-04", 3)];
  const plain: PlantInput = {
    id: "p",
    style: "let_top_dry",
    intervalDays: 7,
    placement: "outdoor_pot",
    sun: "full_sun",
    lastWatered: "2026-05-28",
  };
  it("one entry equals no history", () => {
    const one: PlantInput = {
      ...plain,
      placementHistory: [{ on: "2026-01-01", placement: "outdoor_pot" }],
    };
    const a = planDays({ today: "2026-06-06", plants: [plain], weather });
    const b = planDays({ today: "2026-06-06", plants: [one], weather });
    assert.deepEqual(b, a);
    assert.deepEqual(
      computeWindows({ today: "2026-06-06", plants: [one], weather }),
      computeWindows({ today: "2026-06-06", plants: [plain], weather }),
    );
  });
  it("indoor plants ignore history credit entirely", () => {
    const indoor: PlantInput = { ...plain, placement: "indoor" };
    const one: PlantInput = {
      ...indoor,
      placementHistory: [{ on: "2026-01-01", placement: "indoor" }],
    };
    assert.deepEqual(
      planDays({ today: "2026-06-06", plants: [one], weather }),
      planDays({ today: "2026-06-06", plants: [indoor], weather }),
    );
  });
});

describe("recordMove", () => {
  const plain: PlantInput = {
    id: "p",
    style: "let_top_dry",
    intervalDays: 7,
    placement: "indoor",
    lastWatered: "2026-10-01",
  };
  it("the first move writes the base entry (addedOn) and then the new one", () => {
    const r = recordMove(
      { ...plain, addedOn: "2026-03-01" },
      { on: "2026-10-05", placement: "outdoor_pot" },
      "2026-10-09",
    );
    assert.deepEqual(r, {
      ok: true,
      placement: "outdoor_pot",
      sheltered: false,
      placementHistory: [
        { on: "2026-03-01", placement: "indoor" },
        { on: "2026-10-05", placement: "outdoor_pot" },
      ],
    });
  });
  it("the base date falls back to the earliest log, then to the move date", () => {
    const logged = { ...plain, logs: [{ date: "2026-09-01", outcome: "done" as const }] };
    const a = recordMove(logged, { on: "2026-10-05", placement: "outdoor_pot" }, "2026-10-09");
    assert.ok(a.ok);
    assert.equal(a.placementHistory[0]?.on, "2026-09-01");
    const b = recordMove(plain, { on: "2026-10-05", placement: "outdoor_pot" }, "2026-10-09");
    assert.ok(b.ok);
    assert.equal(b.placementHistory[0]?.on, "2026-10-04");
  });
  it("under cover is kept for outdoor entries only", () => {
    const r = recordMove(
      plain,
      { on: "2026-10-05", placement: "outdoor_pot", sheltered: true },
      "2026-10-09",
    );
    assert.ok(r.ok);
    assert.equal(r.sheltered, true);
    assert.deepEqual(r.placementHistory[1], {
      on: "2026-10-05",
      placement: "outdoor_pot",
      sheltered: true,
    });
    const back = recordMove(
      { ...plain, placement: "outdoor_pot", placementHistory: r.placementHistory },
      { on: "2026-10-08", placement: "indoor", sheltered: true },
      "2026-10-09",
    );
    assert.ok(back.ok);
    assert.deepEqual(back.placementHistory[2], { on: "2026-10-08", placement: "indoor" });
  });
  it("never in the future, never before the previous entry, never for the ground", () => {
    const moved = recordMove(plain, { on: "2026-10-05", placement: "outdoor_pot" }, "2026-10-09");
    assert.ok(moved.ok);
    const out = {
      ...plain,
      placement: "outdoor_pot" as const,
      placementHistory: moved.placementHistory,
    };
    assert.deepEqual(recordMove(out, { on: "2026-10-10", placement: "indoor" }, "2026-10-09"), {
      ok: false,
      reason: "future",
    });
    assert.deepEqual(recordMove(out, { on: "2026-10-04", placement: "indoor" }, "2026-10-09"), {
      ok: false,
      reason: "before_previous",
    });
    assert.deepEqual(recordMove(out, { on: "not a date", placement: "indoor" }, "2026-10-09"), {
      ok: false,
      reason: "invalid_date",
    });
    assert.deepEqual(
      recordMove(
        { ...plain, placement: "ground" },
        { on: "2026-10-05", placement: "indoor" },
        "2026-10-09",
      ),
      { ok: false, reason: "ground" },
    );
  });
  it("an equal date replaces the previous entry", () => {
    const moved = recordMove(plain, { on: "2026-10-05", placement: "outdoor_pot" }, "2026-10-09");
    assert.ok(moved.ok);
    const out = {
      ...plain,
      placement: "outdoor_pot" as const,
      placementHistory: moved.placementHistory,
    };
    const r = recordMove(
      out,
      { on: "2026-10-05", placement: "outdoor_pot", sheltered: true },
      "2026-10-09",
    );
    assert.ok(r.ok);
    assert.equal(r.placementHistory.length, 2);
    assert.deepEqual(r.placementHistory[1], {
      on: "2026-10-05",
      placement: "outdoor_pot",
      sheltered: true,
    });
  });
});
