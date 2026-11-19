// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, exportData, importData, type AppData } from "../src/index.ts";

const data: AppData = {
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
  plants: [
    {
      id: "p1",
      spaceId: DEFAULT_SPACE_ID,
      name: "Pothos",
      style: "let_top_dry",
      intervalDays: 7,
      lastWatered: "2026-11-02",
      logs: [],
      sun: "part_shade",
      groundSoil: "loam",
      draught: "no",
    },
  ],
  rooms: [],
  questionState: {
    p1: {
      lastAskedOn: "2026-11-03",
      snoozedUntil: { "Q-MAT": "2026-11-17" },
      snoozes: { "Q-MAT": 2 },
      never: { "Q-SIZE": true },
      neverPlant: true,
    },
  },
  settings: {
    hemisphere: "north",
    horizonDays: 28,
    prefs: { preLeaveWatering: true },
    questions: "off",
  },
};

describe("question state in the export", () => {
  it("round-trips question state, the questions setting and the ground/draught fields", () => {
    const back = importData(exportData(data)).data;
    assert.deepEqual(back.questionState, data.questionState);
    assert.equal(back.settings.questions, "off");
    assert.equal(back.plants[0]?.sun, "part_shade");
    assert.equal(back.plants[0].groundSoil, "loam");
    assert.equal(back.plants[0].draught, "no");
  });

  it("an older file has no question state and the questions are on", () => {
    const text = JSON.stringify({
      format: "green-garden-export",
      version: 8,
      plants: [],
      rooms: [],
    });
    const back = importData(text).data;
    assert.equal(back.questionState, undefined);
    assert.equal(back.settings.questions, undefined);
  });

  it("drops junk: unknown plants keep their entry, bad shapes and unknown values do not", () => {
    const text = JSON.stringify({
      format: "green-garden-export",
      version: 8,
      plants: [],
      rooms: [],
      questionState: {
        p1: {
          lastAskedOn: "yesterday",
          snoozedUntil: { a: "2026-11-17", b: 5 },
          snoozes: { a: 1, b: "x" },
          never: { a: true, b: false },
        },
        p2: "nope",
      },
      settings: { questions: "maybe" },
    });
    const back = importData(text).data;
    assert.deepEqual(back.questionState, {
      p1: { snoozedUntil: { a: "2026-11-17" }, snoozes: { a: 1 }, never: { a: true } },
    });
    assert.equal(back.settings.questions, undefined);
  });
});
