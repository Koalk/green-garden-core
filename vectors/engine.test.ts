// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWindows,
  formatDate,
  parseDate,
  planDays,
  wateringHint,
  weekday,
  type PlanInput,
  type PlantInput,
} from "@green-garden/engine";

const today = "2026-11-02"; // a Monday

const fern: PlantInput = {
  id: "fern",
  style: "keep_moist",
  intervalDays: 4,
  lastWatered: "2026-10-31",
};
const monstera: PlantInput = {
  id: "monstera",
  style: "let_top_dry",
  intervalDays: 7,
  lastWatered: "2026-11-02",
};

function windowOf(input: PlanInput, id: string): { earliest: string; latest: string } {
  const w = computeWindows(input).windows.find((x) => x.plantId === id);
  assert.ok(w, `window for ${id}`);
  return { earliest: w.earliest, latest: w.latest };
}

describe("dates", () => {
  it("round-trips across leap years and centuries", () => {
    for (const s of ["1970-01-01", "2000-02-29", "2024-02-29", "2026-11-02", "2100-03-01"]) {
      const n = parseDate(s);
      assert.notEqual(n, undefined);
      assert.equal(formatDate(n ?? 0), s);
    }
  });
  it("rejects impossible dates", () => {
    for (const s of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "26-1-1", ""]) {
      assert.equal(parseDate(s), undefined, s);
    }
  });
  it("knows the weekday", () => {
    assert.equal(weekday(parseDate("2026-11-02") ?? 0), 1);
    assert.equal(weekday(parseDate("1970-01-01") ?? 0), 4);
    assert.equal(weekday(parseDate("1969-12-31") ?? 0), 3);
  });
});

describe("windows", () => {
  it("an unwatered plant is due today", () => {
    const w = windowOf(
      { today, plants: [{ id: "x", style: "let_top_dry", intervalDays: 7 }] },
      "x",
    );
    assert.equal(w.earliest, today);
  });
  it("an overdue window is clamped to today and reports the days overdue", () => {
    const r = computeWindows({
      today,
      plants: [{ id: "x", style: "keep_moist", intervalDays: 4, lastWatered: "2026-10-20" }],
    });
    assert.equal(r.windows.at(0)?.earliest, today);
    assert.equal(r.windows.at(0)?.latest, today);
    assert.ok((r.windows.at(0)?.overdueDays ?? 0) > 0);
  });
  it("bad input becomes issues, not exceptions", () => {
    const r = computeWindows({
      today,
      plants: [
        { id: "a", style: "keep_moist", intervalDays: 0 },
        { id: "b", style: "keep_moist", intervalDays: 3, lastWatered: "not a date" },
        { id: "c", style: "keep_moist", intervalDays: 3 },
        { id: "c", style: "keep_moist", intervalDays: 3 },
      ],
    });
    assert.equal(r.windows.length, 1);
    assert.equal(r.issues.length, 3);
    assert.deepEqual(computeWindows({ today: "nope" }).issues, ["invalid today"]);
  });
  it("does not change its input and ignores plant order", () => {
    const input: PlanInput = { today, plants: [monstera, fern] };
    const frozen = JSON.stringify(input);
    const a = computeWindows(input);
    const b = computeWindows({ today, plants: [fern, monstera] });
    assert.equal(JSON.stringify(input), frozen);
    assert.deepEqual(a, b);
  });
});

describe("season", () => {
  it("applies the rest factor as a ramp from the date of the last watering", () => {
    const plant: PlantInput = { ...monstera, restFactor: 2, lastWatered: "2026-10-31" };
    const ramp = windowOf({ today, plants: [plant] }, "monstera");
    const rest = windowOf({ today, plants: [{ ...plant, lastWatered: "2026-12-01" }] }, "monstera");
    const growth = windowOf(
      { today, plants: [{ ...plant, lastWatered: "2026-07-01" }] },
      "monstera",
    );
    // 31 October at 55 N is 29/30 of the way up: factor 1.97, I=14 (13.9), band [10,18]
    assert.equal(ramp.earliest, "2026-11-10");
    assert.equal(rest.earliest, "2026-12-11"); // I=14, band [10,18]
    assert.equal(growth.earliest, "2026-11-02"); // I=7, band [5,9]: long past, so today
  });
});

describe("learning", () => {
  it("a skipped log changes nothing", () => {
    const base = windowOf({ today, plants: [monstera] }, "monstera");
    const skipped = windowOf(
      {
        today,
        plants: [{ ...monstera, logs: [{ date: "2026-11-03", outcome: "skipped" }] }],
      },
      "monstera",
    );
    assert.deepEqual(skipped, base);
  });
  it("still_wet is capped by the dry tolerance", () => {
    const logs = [
      { date: "2026-11-09", outcome: "still_wet" as const },
      { date: "2026-11-10", outcome: "still_wet" as const },
      { date: "2026-11-11", outcome: "still_wet" as const },
    ];
    const free = windowOf({ today: "2026-11-12", plants: [{ ...monstera, logs }] }, "monstera");
    const capped = windowOf(
      { today: "2026-11-12", plants: [{ ...monstera, dryTolDays: 1, logs }] },
      "monstera",
    );
    assert.ok(capped.latest < free.latest);
  });
  it("the learned adjustment decays after three on-time waterings", () => {
    const plant: PlantInput = { ...monstera, adjustmentDays: 2, doneStreak: 2 };
    const before = windowOf({ today: "2026-11-02", plants: [plant] }, "monstera");
    const after = windowOf(
      {
        today: "2026-11-12",
        plants: [{ ...plant, logs: [{ date: "2026-11-11", outcome: "done" }] }],
      },
      "monstera",
    );
    assert.equal(before.earliest, "2026-11-09"); // I = 7 + 2 = 9, band [7,11]
    // Third on-time watering: adjustment 2 -> 1, I = 8, band [6,10], anchor 11-20: ends 11-21, not 11-22.
    assert.deepEqual(after, { earliest: "2026-11-18", latest: "2026-11-21" });
  });
});

describe("planning", () => {
  it("never plans a day on an unavailable weekday or date", () => {
    const plan = planDays({
      today,
      horizonDays: 28,
      prefs: { unavailableWeekdays: [6, 0], unavailableDates: ["2026-11-10"] },
      plants: [monstera, fern, { id: "pothos", style: "let_top_dry", intervalDays: 8 }],
    });
    for (const d of plan.days) {
      const n = parseDate(d.date) ?? 0;
      assert.ok(weekday(n) !== 0 && weekday(n) !== 6, d.date);
      assert.notEqual(d.date, "2026-11-10");
    }
  });
  it("away days 10 to 16 of the E6 collection flag the plants 02a 5.4 names", () => {
    const e6: PlantInput[] = [
      { id: "monstera", style: "let_top_dry", intervalDays: 7, lastWatered: "2026-10-30" },
      { id: "pothos", style: "let_top_dry", intervalDays: 8, lastWatered: "2026-10-29" },
      { id: "fern", style: "keep_moist", intervalDays: 4, lastWatered: "2026-10-31" },
      { id: "snake", style: "let_fully_dry", intervalDays: 21, lastWatered: "2026-10-23" },
      { id: "jade", style: "let_fully_dry", intervalDays: 14, lastWatered: "2026-10-28" },
      { id: "peace-lily", style: "keep_moist", intervalDays: 5, lastWatered: "2026-11-01" },
      { id: "spider", style: "let_top_dry", intervalDays: 7, lastWatered: "2026-10-28" },
      { id: "calathea", style: "keep_moist", intervalDays: 4, lastWatered: "2026-10-30" },
      { id: "zz", style: "let_fully_dry", intervalDays: 18, lastWatered: "2026-10-24" },
      { id: "rubber", style: "let_top_dry", intervalDays: 9, lastWatered: "2026-10-31" },
    ];
    const away = ["12", "13", "14", "15", "16", "17", "18"].map((d) => `2026-11-${d}`);
    const plan = planDays({
      today,
      horizonDays: 28,
      prefs: { unavailableDates: away, preLeaveWatering: false },
      plants: e6,
    });
    for (const d of plan.days) assert.ok(!away.includes(d.date), d.date);
    const flagged = plan.plants.filter((p) => p.outlook.severity > 0).map((p) => p.plantId);
    // 02a 5.4: Monstera, Pothos, Fern, Peace lily, Calathea (day 13) and Spider, Rubber (day 16).
    // only plants the stretch pushes past their dry tolerance are flagged now (the others were late but inside it); a gap the
    // away days made inside the tolerance is no warning.
    for (const id of ["fern", "calathea"]) {
      assert.ok(flagged.includes(id), `${id} flagged`);
    }
    // The 4-day plants are the worst off (02a: "scrape by or worse").
    for (const id of ["fern", "calathea"]) {
      const p = plan.plants.find((x) => x.plantId === id);
      assert.ok((p?.outlook.severity ?? 0) >= 2, id);
    }
    for (const id of ["snake", "jade", "zz"]) {
      assert.equal(plan.plants.find((x) => x.plantId === id)?.outlook.level, "thrive", id);
    }
  });
  it("a plant with no free day before the horizon ends is reported unserved", () => {
    const plan = planDays({
      today,
      horizonDays: 5,
      prefs: {
        unavailableDates: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
        preLeaveWatering: false,
      },
      plants: [fern],
    });
    assert.equal(plan.days.length, 0);
    assert.equal(plan.plants.at(0)?.outlook.level, "survive");
    assert.ok(plan.plants.at(0)?.outlook.reasons.includes("unserved"));
  });
  it("reminder-only plants stay out of the plan", () => {
    const plan = planDays({
      today,
      plants: [fern, { id: "air", style: "keep_moist", intervalDays: 7, reminderOnly: true }],
    });
    assert.deepEqual(plan.reminderOnly, ["air"]);
    assert.ok(plan.plants.every((p) => p.plantId !== "air"));
  });
  it("an empty plant list gives an empty plan", () => {
    const plan = planDays({ today });
    assert.equal(plan.days.length, 0);
    assert.equal(plan.summary.savingPercent, 0);
  });
});

describe("stability rules", () => {
  const a: PlantInput = {
    id: "a",
    style: "let_top_dry",
    intervalDays: 7,
    lastWatered: "2026-10-20",
  };
  const b: PlantInput = {
    id: "b",
    style: "let_top_dry",
    intervalDays: 7,
    lastWatered: "2026-10-27",
  };
  const onToday = (plants: PlantInput[]): string[] =>
    planDays({ today, plants })
      .days.find((d) => d.date === today)
      ?.plantIds.slice() ?? [];

  const log = (x: PlantInput, outcome: "done" | "skipped" | "still_wet"): PlantInput => ({
    ...x,
    logs: [{ date: today, outcome }],
  });
  const c: PlantInput = { ...a, id: "c" };

  it("done on the plant that set today keeps the joined plants on today (rule 22)", () => {
    assert.deepEqual(onToday([a, b]), ["a", "b"]);
    assert.ok(onToday([log(a, "done"), b]).includes("b"));
  });

  it("snoozing the only plant that set today releases the joined plants (rule 23)", () => {
    assert.deepEqual(onToday([a, b]), ["a", "b"]);
    assert.ok(!onToday([log(a, "still_wet"), b]).includes("b"));
    assert.ok(!onToday([log(a, "skipped"), b]).includes("b"));
  });

  it("snoozing one of two setters keeps today, in either click order (rule 23)", () => {
    assert.deepEqual(onToday([a, b, c]), ["a", "b", "c"]);
    assert.deepEqual(onToday([log(a, "still_wet"), b, c]), ["b", "c"]);
    assert.deepEqual(onToday([a, b, log(c, "still_wet")]), ["a", "b"]);
    // both snoozed, in either order: the joined plant goes back to its own day
    assert.deepEqual(onToday([log(a, "still_wet"), b, log(c, "still_wet")]), []);
  });

  it("snoozing everything, then watering one, pins today again (rule 22 after 23)", () => {
    const plan = onToday([
      log(a, "still_wet"),
      b,
      { ...c, logs: [{ date: today, outcome: "done" }] },
    ]);
    assert.ok(plan.includes("b"));
  });

  it("a log dated after today is ignored until today reaches it", () => {
    const future: PlantInput = { ...a, logs: [{ date: "2026-11-10", outcome: "done" }] };
    assert.deepEqual(planDays({ today, plants: [future] }), planDays({ today, plants: [a] }));
  });
});

describe("watering amount as a household measure (rule 20: codes, not prose)", () => {
  const measure = (potDiameterCm: number): unknown =>
    wateringHint({ style: "let_top_dry", potDiameterCm }).measure;

  it("rounds to half cups and grows with the pot", () => {
    assert.deepEqual(measure(15), { unit: "cup", halves: 3 });
    assert.deepEqual(measure(12), { unit: "cup", halves: 1 });
    assert.deepEqual(measure(20), { unit: "cup", halves: 7 });
  });

  it("big pots switch to litres of a measuring jug, in half litres", () => {
    assert.deepEqual(measure(60), { unit: "litre", count: 21.5 });
  });

  it("never carries a number of ml in the measure", () => {
    for (const d of [9, 12, 15, 20, 30, 45]) {
      for (const style of ["keep_moist", "let_top_dry", "let_fully_dry"] as const) {
        const m = wateringHint({ style, potDiameterCm: d }).measure;
        assert.ok(m === null || !JSON.stringify(m).includes("ml"), `${style} ${d}`);
      }
    }
  });

  it("is hidden when the pot is unknown or tiny", () => {
    assert.equal(wateringHint({ style: "keep_moist" }).measure, null);
    assert.equal(wateringHint({ style: "let_fully_dry", potDiameterCm: 8 }).measure, null);
  });

  it("the engine returns codes and numbers, never sentences", () => {
    for (const style of ["keep_moist", "let_top_dry", "let_fully_dry"] as const) {
      const hint = wateringHint({ style, potDiameterCm: 15 });
      assert.equal(hint.style, style);
      assert.doesNotMatch(JSON.stringify(hint), /[a-z] [a-z]/i);
    }
  });
});

describe("pinned pre-leave waterings", () => {
  // Found by search: p1 is watered early on 11-04 before the away stretch. Marking p0 "dry early"
  // today used to drop that watering, because the group that decides "the day before the gap" changed.
  const away = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"];
  const plants: PlantInput[] = [
    { id: "p0", style: "keep_moist", intervalDays: 3, lastWatered: "2026-10-29" },
    { id: "p1", style: "let_top_dry", intervalDays: 5, lastWatered: "2026-11-01" },
  ];
  const input: PlanInput = {
    today,
    horizonDays: 20,
    prefs: { preLeaveWatering: true, unavailableDates: [...away, "2026-11-11"] },
    plants,
  };
  const preLeave = (r: ReturnType<typeof planDays>, id: string): string[] =>
    (r.plants.find((p) => p.plantId === id)?.waterings ?? [])
      .filter((w) => w.reason === "pre_leave")
      .map((w) => w.date);
  const logged: PlantInput[] = [
    { ...(plants[0] as PlantInput), logs: [{ date: today, outcome: "dry_early" }] },
    plants[1] as PlantInput,
  ];

  it("the scenario: p1 has a pre-leave watering on 11-04", () => {
    assert.deepEqual(preLeave(planDays(input), "p1"), ["2026-11-04"]);
  });

  it("without a pin another plant's log removes it (why the pin exists)", () => {
    assert.deepEqual(preLeave(planDays({ ...input, plants: logged }), "p1"), []);
  });

  it("with a pin it stays on its day, with reason pre_leave and its day in the plan", () => {
    const pinned = planDays({
      ...input,
      plants: logged,
      pinned: [{ plantId: "p1", date: "2026-11-04" }],
    });
    assert.deepEqual(preLeave(pinned, "p1"), ["2026-11-04"]);
    assert.ok(pinned.days.some((d) => d.date === "2026-11-04" && d.plantIds.includes("p1")));
  });

  it("a pin changes nothing when the plan would have it anyway", () => {
    const plain = planDays(input);
    const pinned = planDays({ ...input, pinned: [{ plantId: "p1", date: "2026-11-04" }] });
    assert.deepEqual(pinned.days, plain.days);
  });

  it("stale pins are ignored: past date, unknown plant, away day, or already watered since", () => {
    const stale = [
      { plantId: "p1", date: "2026-11-01" }, // before today
      { plantId: "ghost", date: "2026-11-04" }, // no such plant
      { plantId: "p1", date: "2026-11-06" }, // an away day
      { plantId: "p1", date: "not a date" },
    ];
    assert.deepEqual(planDays({ ...input, pinned: stale }), planDays(input));
    const wateredAfter: PlantInput[] = [
      plants[0] as PlantInput,
      { ...(plants[1] as PlantInput), logs: [{ date: today, outcome: "done" }] },
    ];
    const r = planDays({
      ...input,
      plants: wateredAfter,
      pinned: [{ plantId: "p1", date: "2026-11-03" }],
    });
    assert.ok(
      !preLeave(r, "p1").includes("2026-11-03"),
      "watered today, pin one day later is too soon",
    );
  });

  it("a pin is ignored when no away day is left near the plant's window", () => {
    const open = { ...input, prefs: { preLeaveWatering: true, unavailableDates: [] } };
    const r = planDays({ ...open, pinned: [{ plantId: "p1", date: "2026-11-04" }] });
    assert.deepEqual(r, planDays(open));
  });

  it("pins do nothing when pre-leave watering is switched off", () => {
    const off = { ...input, prefs: { ...input.prefs, preLeaveWatering: false } };
    const r = planDays({ ...off, pinned: [{ plantId: "p1", date: "2026-11-04" }] });
    assert.deepEqual(preLeave(r, "p1"), []);
  });
});

describe("amount calibration (C15)", () => {
  const pot15 = { style: "let_top_dry", potDiameterCm: 15 } as const; // 350 ml uncalibrated

  it("without calibration nothing changes and no level is reported", () => {
    const h = wateringHint(pot15);
    assert.equal(h.volumeMl, 350);
    assert.equal(h.calibration, null);
  });

  it("a global factor scales the estimate and says it was global", () => {
    const h = wateringHint({ ...pot15, calibration: { global: { factor: 2 } } });
    assert.equal(h.volumeMl, 700);
    assert.equal(h.calibration, "global");
  });

  it("the most specific level wins: plant, then room, then global", () => {
    const all = {
      global: { factor: 2 },
      room: { factor: 0.5 },
      plant: { measuredMl: 500 },
    };
    const plant = wateringHint({ ...pot15, calibration: all });
    assert.equal(plant.volumeMl, 500);
    assert.equal(plant.calibration, "plant");
    const room = wateringHint({ ...pot15, calibration: { global: all.global, room: all.room } });
    assert.equal(room.volumeMl, 200);
    assert.equal(room.calibration, "room");
    const plantFactor = wateringHint({
      ...pot15,
      calibration: { ...all, plant: { factor: 3 } },
    });
    assert.equal(plantFactor.volumeMl, 1050);
    assert.equal(plantFactor.calibration, "plant");
  });

  it("a measured amount works without a pot size", () => {
    const h = wateringHint({ style: "keep_moist", calibration: { plant: { measuredMl: 300 } } });
    assert.equal(h.volumeMl, 300);
    assert.equal(h.calibration, "plant");
    assert.deepEqual(h.measure, { unit: "cup", halves: 3 });
  });

  it("a factor needs a pot size to scale", () => {
    const h = wateringHint({ style: "keep_moist", calibration: { global: { factor: 2 } } });
    assert.equal(h.volumeMl, null);
    assert.equal(h.calibration, null);
  });

  it("nonsense values are skipped and the next level is used", () => {
    for (const bad of [
      { factor: 0 },
      { factor: -1 },
      { factor: Number.NaN },
      { measuredMl: 0 },
      { measuredMl: -5 },
      {},
    ]) {
      const h = wateringHint({
        ...pot15,
        calibration: { plant: bad, room: { factor: 2 } },
      });
      assert.equal(h.calibration, "room", JSON.stringify(bad));
      assert.equal(h.volumeMl, 700);
    }
  });

  it("a calibrated amount under 100 ml is still hidden, and big ones are rounded to 50 ml", () => {
    assert.equal(
      wateringHint({ ...pot15, calibration: { plant: { measuredMl: 80 } } }).volumeMl,
      null,
    );
    assert.equal(
      wateringHint({ ...pot15, calibration: { plant: { measuredMl: 420 } } }).volumeMl,
      400,
    );
  });
});

describe("uncertainty margin (01i section 3)", () => {
  // Monstera: let_top_dry, 7 days, watered today: window ends 2026-11-11 without a margin (earliest 2026-11-07).
  const base: PlantInput = { ...monstera };
  const later = (extra: Partial<PlantInput>): string =>
    windowOf({ today, plants: [{ ...base, ...extra }] }, "monstera").latest;

  it("no margin by default: the window is unchanged and the wording is exact", () => {
    const r = computeWindows({ today, plants: [base] });
    assert.equal(r.windows[0]?.latest, "2026-11-11");
    assert.equal(r.windows[0].marginDays, 0);
    assert.equal(r.windows[0].wording, "exact");
  });

  it("each uncertain day stretches the end of the window by one day", () => {
    assert.equal(later({ uncertaintyDays: 1 }), "2026-11-12");
    assert.equal(later({ uncertaintyDays: 2 }), "2026-11-13");
  });

  it("is capped at 3 days", () => {
    assert.equal(later({ uncertaintyDays: 3 }), "2026-11-14");
    assert.equal(later({ uncertaintyDays: 9 }), "2026-11-14");
  });

  it("ignores nonsense values and rounds down fractions", () => {
    for (const bad of [-2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(later({ uncertaintyDays: bad }), "2026-11-11", String(bad));
    }
    assert.equal(later({ uncertaintyDays: 1.9 }), "2026-11-12");
  });

  it("never moves the start of the window and softens the wording", () => {
    const plain = windowOf({ today, plants: [base] }, "monstera");
    const soft = computeWindows({ today, plants: [{ ...base, uncertaintyDays: 2 }] }).windows[0];
    assert.equal(soft?.earliest, plain.earliest);
    assert.equal(soft.marginDays, 2);
    assert.equal(soft.wording, "around");
  });

  it("a plant long past even the widened end is still overdue", () => {
    const r = computeWindows({ today: "2026-11-30", plants: [{ ...base, uncertaintyDays: 3 }] });
    assert.ok((r.windows[0]?.overdueDays ?? 0) > 0);
  });
});
