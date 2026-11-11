// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, type AppData, type Plant } from "@green-garden/storage";
import { answerQuestion, detailRows, improveRows } from "../src/improve.ts";

// Q-SUNHOURS in the improve list and the detail rows; Q-GROUND is soil only.

const TODAY = "2026-11-03";

const plant = (extra: Partial<Plant> = {}): Plant => ({
  id: "a",
  spaceId: DEFAULT_SPACE_ID,
  name: "Plant a",
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  placement: "outdoor_pot",
  ...extra,
});

const dataOf = (p: Plant): AppData => ({
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
  plants: [p],
  rooms: [],
  settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
});

const answer = (d: AppData, v: string) => answerQuestion(d, "a", "Q-SUNHOURS", v, TODAY).plants[0];

describe("answering Q-SUNHOURS", () => {
  const d = dataOf(plant());

  it("maps each preset to its ranges, as the person's own answer", () => {
    assert.deepEqual(answer(d, "morning")?.directSun, [{ from: 6, to: 11 }]);
    assert.deepEqual(answer(d, "midday")?.directSun, [{ from: 11, to: 15 }]);
    assert.deepEqual(answer(d, "afternoon")?.directSun, [{ from: 15, to: 19 }]);
    assert.deepEqual(answer(d, "morning_afternoon")?.directSun, [
      { from: 7, to: 11 },
      { from: 15, to: 18 },
    ]);
    assert.deepEqual(answer(d, "most_of_day")?.directSun, [{ from: 8, to: 18 }]);
    assert.deepEqual(answer(d, "none")?.directSun, []);
    assert.equal(answer(d, "morning")?.fieldSources?.directSun, "user");
  });

  it("'not sure' and junk change nothing", () => {
    assert.equal(answer(d, "not_sure")?.directSun, undefined);
    assert.equal(answer(d, "sideways")?.directSun, undefined);
  });
});

describe("Q-GROUND is soil only", () => {
  it("a soil answer sets the soil; a sun value is no longer an option", () => {
    const d = dataOf(plant({ placement: "ground" }));
    const at = (v: string) => answerQuestion(d, "a", "Q-GROUND", v, TODAY).plants[0];
    assert.equal(at("clay")?.groundSoil, "clay");
    assert.equal(at("full_sun")?.sun, undefined);
  });
});

describe("the list and the detail rows", () => {
  it("lists Q-SUNHOURS for a pot outside and for the ground, never indoors", () => {
    const ids = (p: Plant) => improveRows(dataOf(p), TODAY)[0]?.questions.map((q) => q.id) ?? [];
    assert.ok(ids(plant()).includes("Q-SUNHOURS"));
    assert.ok(ids(plant({ placement: "ground" })).includes("Q-SUNHOURS"));
    assert.ok(!ids(plant({ placement: "indoor" })).includes("Q-SUNHOURS"));
  });

  it("the detail row shows the preset, exact hours in edit, and 'not set' when unknown", () => {
    const row = (p: Plant) =>
      detailRows(dataOf(p), "a").find((r) => r.question.id === "Q-SUNHOURS");
    assert.equal(row(plant())?.value, undefined);
    assert.equal(row(plant())?.chip, "assumed");
    assert.equal(row(plant({ directSun: [{ from: 6, to: 11 }] }))?.value, "morning");
    assert.equal(row(plant({ directSun: [] }))?.value, "none");
    assert.equal(row(plant({ directSun: [{ from: 7, to: 11 }] }))?.value, "7:00-11:00");
    assert.equal(
      row(plant({ directSun: [{ from: 7, to: 11 }], fieldSources: { directSun: "user" } }))?.chip,
      "you",
    );
  });

  it("indoor plants have no such row; the ground row shows the soil only", () => {
    const rows = (p: Plant) => detailRows(dataOf(p), "a");
    assert.ok(!rows(plant({ placement: "indoor" })).some((r) => r.question.id === "Q-SUNHOURS"));
    const ground = rows(plant({ placement: "ground", sun: "full_sun", groundSoil: "loam" }));
    assert.equal(ground.find((r) => r.question.id === "Q-GROUND")?.value, "loam");
  });
});
