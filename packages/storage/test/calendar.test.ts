// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, makePlan, planToIcs, type AppData } from "../src/index.ts";

const TODAY = "2026-11-02";
const data: AppData = {
  ...emptyData(),
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Fern, big",
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-11-01",
      logs: [],
    },
  ],
};
const summary = (n: number): string => `Water ${n}`;

describe("shared plan and calendar output", () => {
  it("makePlan plans the first space", () => {
    const plan = makePlan(data, TODAY);
    assert.ok(plan.days.length > 0);
  });

  it("planToIcs emits one event per day with CRLF and escaped names", () => {
    const plan = makePlan(data, TODAY);
    const ics = planToIcs(plan, data, TODAY, summary);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.equal(ics.split("BEGIN:VEVENT").length - 1, plan.days.length);
    assert.ok(ics.includes("DESCRIPTION:Fern\\, big\r\n"), "comma escaped");
    assert.match(ics, /SUMMARY:Water 1\r\n/);
    assert.equal(ics, planToIcs(plan, data, TODAY, summary), "deterministic");
  });
});
