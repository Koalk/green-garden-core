// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, type AppData, type Plant } from "@green-garden/storage";
import {
  STOP_AFTER,
  dueReminder,
  minutesOfDay,
  recordSent,
  type ReminderState,
} from "../src/index.ts";

const TODAY = "2026-11-02";

function plant(id: string, extra: Partial<Plant> = {}): Plant {
  return {
    id,
    spaceId: "space1",
    name: id.toUpperCase(),
    style: "keep_moist",
    intervalDays: 4,
    lastWatered: "2026-10-29", // due today
    logs: [],
    ...extra,
  };
}

function dataWith(plants: Plant[], enabled = true, time = "08:00"): AppData {
  const base = emptyData();
  return {
    ...base,
    plants,
    settings: {
      ...base.settings,
      reminders: { enabled, time, email: "me@example.org", smtp: { host: "smtp.example.org" } },
    },
  };
}

const none: ReminderState = { sent: {} };

describe("reminder core (D-08)", () => {
  it("parses HH:MM into minutes", () => {
    assert.equal(minutesOfDay("08:00"), 480);
    assert.equal(minutesOfDay("23:59"), 1439);
  });

  it("names the plants due today once the set time has passed", () => {
    const d = dataWith([plant("a"), plant("b", { lastWatered: "2026-11-02" })]);
    const due = dueReminder({ data: d, today: TODAY, minutes: 8 * 60, state: none });
    assert.ok(due);
    assert.deepEqual(due.plantIds, ["a"]);
    assert.deepEqual(due.names, ["A"]);
  });

  it("waits for the set time", () => {
    const d = dataWith([plant("a")], true, "08:00");
    assert.equal(dueReminder({ data: d, today: TODAY, minutes: 479, state: none }), undefined);
    assert.ok(dueReminder({ data: d, today: TODAY, minutes: 480, state: none }));
  });

  it("sends nothing when disabled or unconfigured", () => {
    const off = dataWith([plant("a")], false);
    assert.equal(dueReminder({ data: off, today: TODAY, minutes: 600, state: none }), undefined);
    const unset = { ...emptyData(), plants: [plant("a")] };
    assert.equal(dueReminder({ data: unset, today: TODAY, minutes: 600, state: none }), undefined);
  });

  it("sends at most one email per day", () => {
    const d = dataWith([plant("a")]);
    const once = recordSent(none, ["a"], TODAY);
    assert.equal(dueReminder({ data: d, today: TODAY, minutes: 600, state: once }), undefined);
  });

  it("skips plants already logged today", () => {
    const d = dataWith([plant("a", { logs: [{ date: TODAY, outcome: "skipped" }] })]);
    assert.equal(dueReminder({ data: d, today: TODAY, minutes: 600, state: none }), undefined);
  });

  it("stops for a plant after 3 unactioned reminders", () => {
    const d = dataWith([plant("a"), plant("b")]);
    let state: ReminderState = none;
    for (const day of ["2026-10-30", "2026-10-31", "2026-11-01"]) {
      state = recordSent(state, ["a"], day);
    }
    assert.equal(STOP_AFTER, 3);
    const due = dueReminder({ data: d, today: TODAY, minutes: 600, state });
    assert.deepEqual(due?.plantIds, ["b"], "a is silenced, b is not");
  });

  it("two unactioned reminders still send the third", () => {
    const d = dataWith([plant("a")]);
    const state = recordSent(recordSent(none, ["a"], "2026-10-31"), ["a"], "2026-11-01");
    assert.deepEqual(dueReminder({ data: d, today: TODAY, minutes: 600, state })?.plantIds, ["a"]);
  });

  it("any log resumes reminders, whatever its outcome", () => {
    let state: ReminderState = none;
    for (const day of ["2026-10-30", "2026-10-31", "2026-11-01"]) {
      state = recordSent(state, ["a"], day);
    }
    const silenced = dataWith([plant("a")]);
    assert.equal(dueReminder({ data: silenced, today: TODAY, minutes: 600, state }), undefined);
    for (const outcome of ["skipped"] as const) {
      const logged = dataWith([
        plant("a", { lastWatered: "2026-10-29", logs: [{ date: "2026-11-01", outcome }] }),
      ]);
      // 2026-11-01 is after all three reminders, so the count is back to 0
      const due = dueReminder({ data: logged, today: TODAY, minutes: 600, state });
      assert.deepEqual(due?.plantIds, ["a"], outcome);
    }
  });

  it("a log on the day of a reminder counts as actioning it", () => {
    let state: ReminderState = none;
    for (const day of ["2026-10-30", "2026-10-31", "2026-11-01"]) {
      state = recordSent(state, ["a"], day);
    }
    const d = dataWith([plant("a", { logs: [{ date: "2026-11-01", outcome: "skipped" }] })]);
    assert.ok(dueReminder({ data: d, today: TODAY, minutes: 600, state }));
  });

  it("recording the same day twice does not count twice", () => {
    const state = recordSent(recordSent(none, ["a"], "2026-11-01"), ["a"], "2026-11-01");
    assert.deepEqual(state.sent["a"], ["2026-11-01"]);
  });
});
