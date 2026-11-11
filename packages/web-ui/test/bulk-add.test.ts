// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import {
  advance,
  makeMatcher,
  runMatch,
  saveBulk,
  setWatered,
  startBulk,
} from "../src/bulk-flow.ts";
import { SPECIES } from "../src/pilot-data.ts";
import { dayEntries, makePlan } from "../src/view.ts";

// The flow's own tests moved to packages/bulk; what Today shows for its plants stays here.
const TODAY = "2026-10-30";
const matched = (text: string) => runMatch(startBulk(text), makeMatcher(SPECIES, "en-GB"));

describe("check the soil today", () => {
  it("a plant added with 'not sure' shows 'check the soil today' on Today", () => {
    const s = advance(advance(matched("aloe vera")));
    const data = saveBulk(emptyData(), s, TODAY).data;
    const entries = dayEntries(makePlan(data, TODAY), data, TODAY);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.checkSoil, true);
  });

  it("not once the user said when it was watered, or has logged it", () => {
    const s = setWatered(advance(advance(matched("aloe vera"))), "today");
    const data = saveBulk(emptyData(), s, TODAY).data;
    const later = "2026-12-01";
    const entries = dayEntries(makePlan(data, later), data, later);
    assert.ok(entries.every((e) => e.checkSoil !== true));
  });
});
