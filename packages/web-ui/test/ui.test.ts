// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { computeWindows, planDays, type PlanResult } from "@green-garden/engine";
import { emptyData, exportData, importData, type AppData } from "@green-garden/storage";
import {
  addAwayRange,
  addPlant,
  addRoom,
  calendarWeeks,
  type CalendarCell,
  dayEntries,
  deletePlant,
  deleteRoom,
  fixtureData,
  fold,
  localIsoDate,
  logOutcome,
  makePlan,
  waterAll,
  nextId,
  amountText,
  bulkConfirmText,
  cantWaterToday,
  preLeaveOn,
  removeAwayDate,
  setPrefs,
  toIcs,
  updatePlant,
  warnings,
} from "../src/index.ts";
import { PILOT, SPECIES } from "../src/pilot-data.ts";

const TODAY = "2026-11-02"; // a Monday

function cell(weeks: CalendarCell[][], w: number, i: number): CalendarCell {
  const c = weeks[w]?.[i];
  assert.ok(c);
  return c;
}

function withPlants(): AppData {
  return fixtureData(TODAY);
}

describe("actions", () => {
  it("nextId skips taken ids", () => {
    assert.equal(nextId(["p1", "p3"], "p"), "p2");
    assert.equal(nextId([], "r"), "r1");
  });

  it("adds, edits and deletes a plant", () => {
    let d = addPlant(emptyData(), { name: "Fern", style: "keep_moist", intervalDays: 4 });
    assert.equal(d.plants[0]?.id, "p1");
    d = addPlant(d, { name: "Aloe", style: "let_fully_dry", intervalDays: 14 });
    assert.equal(d.plants[1]?.id, "p2");
    const fern = d.plants[0];
    assert.ok(fern);
    d = updatePlant(d, { ...fern, name: "Boston fern" });
    assert.equal(d.plants[0]?.name, "Boston fern");
    d = deletePlant(d, "p1");
    assert.deepEqual(
      d.plants.map((p) => p.id),
      ["p2"],
    );
  });

  it("does not mutate its input", () => {
    const d = withPlants();
    const before = JSON.stringify(d);
    logOutcome(d, "p1", "done", TODAY);
    deletePlant(d, "p1");
    addAwayRange(d, "2026-11-05", "2026-11-07");
    assert.equal(JSON.stringify(d), before);
  });

  it("rooms: ignores blanks, and deleting a room unassigns its plants", () => {
    let d = addRoom(emptyData(), "  ");
    assert.equal(d.rooms.length, 0);
    d = addRoom(d, "Kitchen");
    d = addPlant(d, { name: "Fern", style: "keep_moist", intervalDays: 4, roomId: "r1" });
    d = deleteRoom(d, "r1");
    assert.equal(d.rooms.length, 0);
    assert.equal(d.plants[0]?.roomId, undefined);
  });

  it("away range: inclusive, sorted, de-duplicated, validated", () => {
    let d = addAwayRange(emptyData(), "2026-11-05", "2026-11-07");
    assert.ok(d);
    d = addAwayRange(d, "2026-11-07", "2026-11-08");
    assert.ok(d);
    assert.deepEqual(d.spaces[0]?.awayDates, [
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    assert.equal(addAwayRange(d, "2026-11-09", "2026-11-01"), undefined);
    assert.equal(addAwayRange(d, "2026-11-01", "2027-11-01"), undefined);
    assert.equal(addAwayRange(d, "nope", "2026-11-01"), undefined);
    const r = removeAwayDate(d, "2026-11-06");
    assert.equal(r.spaces[0]?.awayDates.length, 3);
  });

  it("setPrefs merges", () => {
    const d = setPrefs(emptyData(), { preLeaveWatering: true });
    assert.equal(d.settings.prefs.preLeaveWatering, true);
  });
});

describe("plan and logging", () => {
  it("is deterministic and passes `today` to the engine", () => {
    const d = withPlants();
    assert.deepEqual(makePlan(d, TODAY), makePlan(d, TODAY));
    assert.equal(makePlan(d, "bad").issues[0], "invalid today");
  });

  it("logging done moves the plant off today and onto a later day", () => {
    const d = withPlants();
    const plan = makePlan(d, TODAY);
    const first = dayEntries(plan, d, TODAY)[0];
    assert.ok(first, "something is due today in the fixture");
    const after = logOutcome(d, first.plantId, "done", TODAY);
    const plan2 = makePlan(after, TODAY);
    assert.ok(!dayEntries(plan2, after, TODAY).some((e) => e.plantId === first.plantId));
    const later = plan2.plants.find((p) => p.plantId === first.plantId)?.waterings[0];
    assert.ok(later && later.date > TODAY);
  });

  it("logging done for one plant keeps the others due today on today", () => {
    for (let k = 0; k < 14; k += 1) {
      const today = `2026-11-${String(2 + k).padStart(2, "0")}`;
      const d = fixtureData(today);
      const due = dayEntries(makePlan(d, today), d, today).map((e) => e.plantId);
      for (const id of due) {
        const after = logOutcome(d, id, "done", today);
        const left = dayEntries(makePlan(after, today), after, today).map((e) => e.plantId);
        assert.deepEqual(
          left,
          due.filter((x) => x !== id),
          `${today}: done ${id}`,
        );
      }
      // Clicking through the list one by one ends with nothing left and nothing skipped.
      let seq = d;
      for (const id of due) {
        const left = dayEntries(makePlan(seq, today), seq, today).map((e) => e.plantId);
        assert.ok(left.includes(id), `${today}: ${id} vanished before its turn`);
        seq = logOutcome(seq, id, "done", today);
      }
      assert.equal(dayEntries(makePlan(seq, today), seq, today).length, 0);
    }
  });

  it("still wet postpones the window", () => {
    const d = withPlants();
    const id = dayEntries(makePlan(d, TODAY), d, TODAY)[0]?.plantId;
    assert.ok(id);
    const before = computeWindows({ today: TODAY, plants: d.plants }).windows.find(
      (w) => w.plantId === id,
    );
    const after = computeWindows({
      today: TODAY,
      plants: logOutcome(d, id, "still_wet", TODAY).plants,
    }).windows.find((w) => w.plantId === id);
    assert.ok(before && after);
    assert.ok(after.earliest > TODAY);
    assert.ok(after.latest >= before.latest);
  });

  it("water all clears today", () => {
    const d = withPlants();
    const ids = dayEntries(makePlan(d, TODAY), d, TODAY).map((e) => e.plantId);
    assert.ok(ids.length > 0);
    const after = waterAll(d, ids, TODAY);
    assert.deepEqual(dayEntries(makePlan(after, TODAY), after, TODAY), []);
  });

  it("every planned entry has a non-empty explanation", () => {
    const d = withPlants();
    const plan = makePlan(d, TODAY);
    for (const day of plan.days) {
      for (const e of dayEntries(plan, d, day.date)) assert.notEqual(e.why, "", e.name);
    }
  });

  it("away days: plan avoids them and warns when the window is blocked", () => {
    let d = withPlants();
    const away = addAwayRange(d, "2026-11-02", "2026-11-20");
    assert.ok(away);
    d = away;
    const plan = makePlan(d, TODAY);
    const awaySet = new Set(d.spaces[0]?.awayDates);
    for (const day of plan.days) assert.ok(!awaySet.has(day.date), day.date);
    const w = warnings(plan, d);
    assert.ok(w.length > 0);
    assert.ok(w.every((x) => x.text.length > 0));
    assert.ok(w[0] && w.every((x) => (w[0] as { severity: number }).severity >= x.severity));
  });
});

describe("calendar", () => {
  it("is Monday-first and covers today through the horizon", () => {
    const d = withPlants();
    const weeks = calendarWeeks(makePlan(d, TODAY), d, TODAY, 28);
    assert.equal(weeks.length, 4);
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(cell(weeks, 0, 0).date, TODAY);
    assert.equal(cell(weeks, 0, 0).isToday, true);
    const inPlan = weeks.flat().filter((c) => c.inPlan);
    assert.equal(inPlan.length, 28);
  });

  it("pads a mid-week start with out-of-plan cells", () => {
    const d = withPlants();
    const weeks = calendarWeeks(makePlan(d, "2026-11-04"), d, "2026-11-04", 7);
    assert.equal(cell(weeks, 0, 0).date, "2026-11-02");
    assert.equal(cell(weeks, 0, 0).inPlan, false);
    assert.equal(cell(weeks, 0, 2).isToday, true);
  });

  it("lists plant names on the planned days", () => {
    const d = withPlants();
    const plan = makePlan(d, TODAY);
    const cells = calendarWeeks(plan, d, TODAY, 28).flat();
    const total = cells.reduce((n, c) => n + c.plantNames.length, 0);
    assert.equal(
      total,
      plan.days.reduce((n, day) => n + day.plantIds.length, 0),
    );
  });
});

describe("ics", () => {
  it("emits one all-day event per planned day with CRLF line ends", () => {
    const d = withPlants();
    const plan = makePlan(d, TODAY);
    const ics = toIcs(plan, d, TODAY);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.equal(ics.split("BEGIN:VEVENT").length - 1, plan.days.length);
    assert.ok(!/[^\r]\n/.test(ics), "no bare LF");
    assert.match(ics, /DTSTART;VALUE=DATE:\d{8}\r\n/);
    assert.equal(ics, toIcs(plan, d, TODAY), "deterministic");
  });

  it("DTEND is the next day, including across a month end", () => {
    const plan: PlanResult = {
      days: [{ date: "2026-11-30", plantIds: ["a"] }],
      plants: [],
      summary: { naiveDays: 1, wateringDays: 1, savingPercent: 0 },
      reminderOnly: [],
      rainFed: [],
      dormant: [],
      rainForecastFor: [],
      issues: [],
    };
    const ics = toIcs(plan, { ...emptyData(), plants: [] }, "2026-11-30");
    assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201\r\n/);
  });

  it("escapes text and folds long lines at 75 octets", () => {
    const d: AppData = {
      ...emptyData(),
      plants: [
        {
          id: "a",
          spaceId: "space1",
          name: "Fern, the; big\\one " + "é".repeat(60),
          style: "keep_moist",
          intervalDays: 3,
        },
      ],
    };
    const plan = planDays({ today: TODAY, plants: d.plants, horizonDays: 3 });
    const ics = toIcs(plan, d, TODAY);
    assert.match(ics, /Fern\\, the\\; big\\\\one/);
    for (const line of ics.split("\r\n")) {
      assert.ok(new TextEncoder().encode(line).length <= 75, line);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    assert.ok(unfolded.includes("é".repeat(60)));
  });

  it("fold never splits a character", () => {
    const parts = fold("X:" + "😀".repeat(40));
    assert.ok(parts.length > 1);
    assert.equal(parts.join("").replace(/ /g, "").length, "X:".length + 80);
  });
});

describe("round trip through the X5 format", () => {
  it("keeps the plan identical after export and import", () => {
    let d = withPlants();
    d = logOutcome(d, "p2", "still_wet", TODAY);
    d = logOutcome(d, "p3", "done", TODAY);
    const away = addAwayRange(d, "2026-11-10", "2026-11-12");
    assert.ok(away);
    const back = importData(exportData(away));
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(makePlan(back.data, TODAY), makePlan(away, TODAY));
  });
});

describe("fixture and helpers", () => {
  it("fixture has 10 plants and valid input", () => {
    const d = fixtureData(TODAY);
    assert.equal(d.plants.length, 10);
    assert.deepEqual(makePlan(d, TODAY).issues, []);
    assert.equal(fixtureData("junk").plants.length, 0);
  });

  it("localIsoDate pads", () => {
    assert.equal(localIsoDate(new Date(2026, 0, 5)), "2026-01-05");
  });
});

describe("pilot fixture", () => {
  const dir = new URL("../../../catalogue-draft/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const entry = (f: string) =>
    (
      JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
        entries: { id: string; care: { baseIntervalDays: { value: number | null } } }[];
      }
    ).entries[0];

  it("pilot-data.ts matches catalogue-draft (run scripts/gen-pilot-fixture.mjs if this fails)", () => {
    assert.equal(SPECIES.length, files.length);
    files.forEach((f, i) => {
      assert.equal(entry(f)?.id, SPECIES[i]?.id);
      assert.equal(entry(f)?.care.baseIntervalDays.value, SPECIES[i]?.intervalDays);
    });
  });

  it("the bundled sample stays at the 10 pilot plants", () => {
    assert.equal(PILOT.length, 10);
    for (const r of PILOT) assert.ok(SPECIES.some((s) => s.id === r.id));
  });
});

describe("pre-leave watering default", () => {
  it("the Holidays checkbox is on unless the user switched it off", () => {
    assert.equal(preLeaveOn({}), true);
    assert.equal(preLeaveOn({ preLeaveWatering: true }), true);
    assert.equal(preLeaveOn({ preLeaveWatering: false }), false);
  });

  it("a fresh household plans a watering before an away range", () => {
    let d = addPlant(emptyData(), {
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-10-31",
    });
    d = addAwayRange(d, "2026-11-03", "2026-11-08") ?? d;
    const plan = makePlan(d, TODAY);
    assert.equal(plan.plants[0]?.waterings[0]?.reason, "pre_leave");
  });
});

describe("amount hint text", () => {
  it("shows the stop point and an amount in the household container, never ml", () => {
    const text = amountText({ style: "let_top_dry", potDiameterCm: 15 });
    assert.match(text, /1½ mugs/);
    assert.doesNotMatch(text, /ml/);
    assert.doesNotMatch(amountText({ style: "keep_moist" }), /ml|mug/);
  });
});

describe("bulk actions on Today", () => {
  const due = (d: AppData): string[] =>
    dayEntries(makePlan(d, TODAY), d, TODAY)
      .filter((e) => !e.handled)
      .map((e) => e.plantId);

  it("water all skips plants already snoozed or skipped today", () => {
    let d = withPlants();
    const ids = due(d);
    assert.ok(ids.length >= 2);
    d = logOutcome(d, ids[0] as string, "still_wet", TODAY);
    const rest = due(d);
    const after = waterAll(d, rest, TODAY);
    const logged = after.plants.filter((p) => (p.logs ?? []).some((l) => l.date === TODAY));
    assert.equal(logged.length, rest.length + 1);
    assert.equal(
      after.plants.find((p) => p.id === ids[0])?.logs?.filter((l) => l.outcome === "done").length,
      0,
    );
    assert.deepEqual(due(after), []);
  });

  it("can't water today makes today an away day and replans", () => {
    const d = withPlants();
    const ids = due(d);
    assert.ok(ids.length > 0);
    const after = cantWaterToday(d, TODAY);
    assert.ok(after.spaces[0]?.awayDates.includes(TODAY));
    const plan = makePlan(after, TODAY);
    assert.deepEqual(plan.issues, []);
    assert.ok(!plan.days.some((x) => x.date === TODAY));
    // everyone who was due still gets a later day (or is flagged), nothing is lost
    for (const id of ids) {
      const pp = plan.plants.find((p) => p.plantId === id);
      assert.ok(pp && (pp.waterings.length > 0 || pp.outlook.severity > 0), id);
    }
    assert.ok(warnings(plan, after).length >= 0);
  });

  it("removing the away date undoes it exactly", () => {
    const d = withPlants();
    const undone = removeAwayDate(cantWaterToday(d, TODAY), TODAY);
    assert.deepEqual(makePlan(undone, TODAY), makePlan(d, TODAY));
  });

  it("a day that is already away is left alone", () => {
    const once = cantWaterToday(withPlants(), TODAY);
    assert.deepEqual(cantWaterToday(once, TODAY), once);
  });

  it("the confirmation names how many plants are affected", () => {
    assert.match(bulkConfirmText("water-all", 3), /3 plants/);
    assert.match(bulkConfirmText("water-all", 1), /1 plant\b/);
    assert.match(bulkConfirmText("cant-water", 4), /4 plants/);
    assert.match(bulkConfirmText("cant-water", 4), /Holidays/);
  });
});
