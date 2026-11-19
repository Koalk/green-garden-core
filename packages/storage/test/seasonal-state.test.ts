// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  VERSION,
  emptyData,
  exportData,
  importData,
  type AppData,
  type Plant,
} from "../src/index.ts";

// The seasonal cards' "Not yet" and "Leave it out" live in the data (format 10), so they
// survive a reload and travel in the export.

const plant: Plant = {
  id: "p1",
  spaceId: DEFAULT_SPACE_ID,
  name: "Calamondin",
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
};
const withState = (seasonal: AppData["seasonal"]): AppData => ({
  ...emptyData(),
  plants: [plant],
  ...(seasonal === undefined ? {} : { seasonal }),
});

describe("seasonal card state in the export", () => {
  it("is format 10 and round-trips both maps", () => {
    assert.equal(VERSION, 10);
    const state = {
      snoozedUntil: { p1: "2026-10-25" },
      leftOutUntil: { p1: "2027-07-01" },
    };
    const text = exportData(withState(state));
    assert.equal((JSON.parse(text) as { version: number }).version, 10);
    const back = importData(text);
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.data.seasonal, state);
  });

  it("no state, no key", () => {
    const text = exportData(withState(undefined));
    assert.equal("seasonal" in (JSON.parse(text) as object), false);
    assert.equal(importData(text).data.seasonal, undefined);
  });

  it("a version 9 file without it still imports", () => {
    const v9 = JSON.stringify({
      format: "green-garden-export",
      version: 9,
      plants: [{ id: "p1", name: "A", style: "keep_moist", intervalDays: 4, logs: [] }],
      rooms: [],
    });
    const r = importData(v9);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.data.plants.length, 1);
    assert.equal(r.data.seasonal, undefined);
  });

  it("drops junk dates and empty maps, keeps the good ones", () => {
    const text = JSON.stringify({
      format: "green-garden-export",
      version: 10,
      plants: [],
      rooms: [],
      seasonal: {
        snoozedUntil: { p1: "2026-10-25", p2: "soon", p3: 5 },
        leftOutUntil: { p1: "nope" },
        extra: 1,
      },
    });
    assert.deepEqual(importData(text).data.seasonal, { snoozedUntil: { p1: "2026-10-25" } });
    const junk = JSON.stringify({
      format: "green-garden-export",
      version: 10,
      plants: [],
      rooms: [],
      seasonal: "x",
    });
    assert.equal(importData(junk).data.seasonal, undefined);
  });
});
