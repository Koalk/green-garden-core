// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  exportData,
  importData,
  type AppData,
  type Plant,
} from "../src/index.ts";

const member = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: `Aloe ${id}`,
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  ...extra,
});

const data: AppData = {
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
  plants: [
    member("p1", { batch: { id: "b1", split: ["Q-POT"] } }),
    member("p2", {
      potDiameterCm: 18,
      fieldSources: { potDiameterCm: "user" },
      batch: {
        id: "b1",
        filled: {
          "Q-POT": {
            from: "p1",
            before: { fields: { potDiameterCm: 15 }, sources: { potDiameterCm: "default" } },
          },
        },
      },
    }),
    member("p3"),
  ],
  rooms: [],
  settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
};

describe("plants added together in the export", () => {
  it("round-trips the batch group, its splits and what a fill changed", () => {
    const back = importData(exportData(data)).data;
    assert.deepEqual(back.plants[0]?.batch, data.plants[0]?.batch);
    assert.deepEqual(back.plants[1]?.batch, data.plants[1]?.batch);
    assert.equal(back.plants[2]?.batch, undefined);
  });

  it("stays export version 9: the batch key is additive and optional", () => {
    assert.equal((JSON.parse(exportData(data)) as { version: number }).version, 9);
  });

  it("drops a malformed batch instead of failing the import", () => {
    const raw = JSON.parse(exportData(data)) as { plants: Record<string, unknown>[] };
    raw.plants[0] = { ...raw.plants[0], batch: { id: 5, split: "x" } };
    raw.plants[1] = { ...raw.plants[1], batch: "nope" };
    const back = importData(JSON.stringify(raw)).data;
    assert.equal(back.plants[0]?.batch, undefined);
    assert.equal(back.plants[1]?.batch, undefined);
  });
});
