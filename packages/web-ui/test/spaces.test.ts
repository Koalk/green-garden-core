// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, spaceView, type AppData } from "@green-garden/storage";
import {
  addAwayRange,
  addPlant,
  addRoom,
  calendarWeeks,
  dayEntries,
  fixtureData,
  logOutcome,
  makePlan,
  plantRows,
  removeAwayDate,
  saveDraft,
} from "../src/index.ts";

const TODAY = "2026-11-02";

/** Home has a fern due today; the office has an identical fern and an away week. */
function twoSpaces(): AppData {
  const base = emptyData();
  const plant = (id: string, spaceId: string) =>
    ({
      id,
      spaceId,
      name: id,
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-10-29",
      logs: [],
    }) as const;
  return {
    ...base,
    spaces: [
      { id: "space1", name: "Home", awayDates: [] },
      {
        id: "space2",
        name: "Office",
        awayDates: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
      },
    ],
    plants: [plant("home-fern", "space1"), plant("office-fern", "space2")],
    rooms: [
      { id: "r1", name: "Kitchen", spaceId: "space1" },
      { id: "r2", name: "Desk", spaceId: "space2" },
    ],
  };
}

describe("two spaces never mix plans", () => {
  it("each plan holds only its own plants", () => {
    const d = twoSpaces();
    assert.deepEqual(
      makePlan(d, TODAY, "space1").plants.map((p) => p.plantId),
      ["home-fern"],
    );
    assert.deepEqual(
      makePlan(d, TODAY, "space2").plants.map((p) => p.plantId),
      ["office-fern"],
    );
  });

  it("one space's away days do not touch the other's plan", () => {
    const d = twoSpaces();
    const home = makePlan(d, TODAY, "space1");
    const alone = makePlan(
      { ...d, plants: d.plants.filter((p) => p.spaceId === "space1") },
      TODAY,
      "space1",
    );
    assert.deepEqual(home, alone);
    const homeDays = home.days.map((x) => x.date);
    const officeDays = makePlan(d, TODAY, "space2").days.map((x) => x.date);
    assert.ok(homeDays.includes(TODAY) || homeDays.includes("2026-11-03"));
    assert.ok(!officeDays.some((x) => ["2026-11-02", "2026-11-03", "2026-11-04"].includes(x)));
  });

  it("identical plants in two spaces are not combined onto shared days", () => {
    const d = twoSpaces();
    const free = { ...d, spaces: d.spaces.map((s) => ({ ...s, awayDates: [] })) };
    for (const space of ["space1", "space2"]) {
      const plan = makePlan(free, TODAY, space);
      for (const day of plan.days) assert.equal(day.plantIds.length, 1, `${space} ${day.date}`);
    }
  });

  it("the UI default is the first space, and the view lists its plants and rooms only", () => {
    const d = twoSpaces();
    assert.deepEqual(
      makePlan(d, TODAY).plants.map((p) => p.plantId),
      ["home-fern"],
    );
    const view = spaceView(d);
    assert.deepEqual(
      view.plants.map((p) => p.id),
      ["home-fern"],
    );
    assert.deepEqual(
      view.rooms.map((r) => r.id),
      ["r1"],
    );
    assert.equal(plantRows(makePlan(d, TODAY), [], view).length, 1);
    assert.ok(
      calendarWeeks(makePlan(d, TODAY), d, TODAY, 7)
        .flat()
        .every((c) => !c.away),
    );
  });

  it("logging a plant in one space leaves the other space's plan alone", () => {
    const d = twoSpaces();
    const before = makePlan(d, TODAY, "space2");
    const after = makePlan(logOutcome(d, "home-fern", "done", TODAY), TODAY, "space2");
    assert.deepEqual(after, before);
    assert.ok(dayEntries(makePlan(d, TODAY), d, TODAY).every((e) => e.plantId === "home-fern"));
  });
});

describe("new things go into the active space", () => {
  it("a plant, a room and a draft", () => {
    let d = twoSpaces();
    d = addPlant(d, { name: "New", style: "keep_moist", intervalDays: 5 });
    assert.equal(d.plants.at(-1)?.spaceId, "space1");
    d = addRoom(d, "Hall");
    assert.equal(d.rooms.at(-1)?.spaceId, "space1");
    d = saveDraft(d, { plantName: "Later" }, TODAY);
    assert.equal(d.drafts?.[0]?.spaceId, "space1");
  });

  it("away days are added to and removed from the active space only", () => {
    const d = twoSpaces();
    const away = addAwayRange(d, "2026-12-01", "2026-12-02") ?? d;
    assert.deepEqual(away.spaces[0]?.awayDates, ["2026-12-01", "2026-12-02"]);
    assert.deepEqual(away.spaces[1]?.awayDates, d.spaces[1]?.awayDates);
    assert.deepEqual(removeAwayDate(away, "2026-12-01").spaces[0]?.awayDates, ["2026-12-02"]);
    assert.equal(
      away.settings.prefs.unavailableDates,
      undefined,
      "not kept in the shared settings",
    );
  });

  it("the sample data has the default space", () => {
    const d = fixtureData(TODAY);
    assert.ok(d.plants.every((p) => p.spaceId === "space1"));
    assert.ok(d.rooms.every((r) => r.spaceId === "space1"));
  });
});
