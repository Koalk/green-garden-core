// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  VERSION,
  emptyData,
  exportData,
  importData,
  migrate,
  type AppData,
  type Plant,
} from "../src/index.ts";

// a plant carries `addedOn`; old plants get an estimate from their own history, marked as such.
// Optional keys are ignored by an older reader, so the export stays format 8.

const base: Plant = {
  id: "p1",
  spaceId: DEFAULT_SPACE_ID,
  name: "Monty",
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
};
const p0 = (d: AppData): Plant | undefined => d.plants[0];
const withPlant = (p: Plant): AppData => ({ ...emptyData(), plants: [p] });

describe("plant addedOn", () => {
  it("round-trips addedOn and its estimated mark, format stays 8", () => {
    assert.equal(VERSION, 9);
    const plant: Plant = { ...base, addedOn: "2026-03-01", addedOnEstimated: true };
    const back = importData(exportData(withPlant(plant)));
    assert.deepEqual(back.warnings, []);
    assert.equal(p0(back.data)?.addedOn, "2026-03-01");
    assert.equal(p0(back.data)?.addedOnEstimated, true);
  });

  it("drops a junk addedOn", () => {
    const text = exportData(withPlant({ ...base, addedOn: "2026-03-01" })).replace(
      "2026-03-01",
      "last spring",
    );
    const back = importData(text);
    assert.equal(p0(back.data)?.addedOn, undefined);
  });

  it("migration estimates addedOn from the earliest log, marked estimated", () => {
    const out = migrate(
      withPlant({
        ...base,
        lastWatered: "2026-05-01",
        logs: [
          { date: "2026-04-10", outcome: "done" },
          { date: "2026-02-02", outcome: "done" },
        ],
      }),
    );
    assert.equal(p0(out)?.addedOn, "2026-02-02");
    assert.equal(p0(out)?.addedOnEstimated, true);
  });

  it("migration falls back to lastWatered, and leaves a plant with no history alone", () => {
    const a = migrate(withPlant({ ...base, lastWatered: "2026-05-01" }));
    assert.equal(p0(a)?.addedOn, "2026-05-01");
    assert.equal(p0(a)?.addedOnEstimated, true);
    const b = migrate(withPlant(base));
    assert.equal(p0(b)?.addedOn, undefined);
  });

  it("migration never touches a real addedOn, and is idempotent", () => {
    const real = migrate(
      withPlant({
        ...base,
        addedOn: "2026-06-01",
        logs: [{ date: "2026-01-01", outcome: "done" }],
      }),
    );
    assert.equal(p0(real)?.addedOn, "2026-06-01");
    assert.equal(p0(real)?.addedOnEstimated, undefined);
    const once = migrate(withPlant({ ...base, lastWatered: "2026-05-01" }));
    assert.deepEqual(migrate(once), once);
  });
});
