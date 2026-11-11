// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, type AppData } from "@green-garden/storage";
import { deletePlant } from "../src/actions.ts";
import { snoozeQuestion } from "../src/improve.ts";

// Moved out of improve.test.ts when that went to packages/bulk: deletePlant is web-ui's action.
describe("web-ui actions and the question state", () => {
  it("deleting a plant forgets its question state", () => {
    const data: AppData = {
      spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
      plants: [
        {
          id: "a",
          spaceId: DEFAULT_SPACE_ID,
          name: "Plant a",
          style: "let_top_dry",
          intervalDays: 7,
          logs: [],
          fieldSources: { potMaterial: "default" },
        },
      ],
      rooms: [],
      settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
    };
    const d = snoozeQuestion(data, "a", "Q-MAT", "2026-11-03");
    assert.ok(d.questionState?.["a"] !== undefined);
    assert.equal(deletePlant(d, "a").questionState?.["a"], undefined);
  });
});
