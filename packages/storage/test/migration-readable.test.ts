// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSION, importData, invalidPlants } from "../src/index.ts";

const STYLES = ["keep_moist", "let_top_dry", "let_fully_dry"] as const;

/** One plant in every care style, as an older file wrote it (no stamps, no log ids, no addedOn). */
function oldFile(version: number): string {
  return JSON.stringify({
    format: "green-garden-export",
    version,
    plants: STYLES.map((style, i) => ({
      id: `p${i}`,
      name: style,
      style,
      intervalDays: 3 + i,
      lastWatered: "2026-10-01",
      logs: [{ date: "2026-10-01", outcome: "done" }],
    })),
    rooms: [{ id: "r1", name: "Kitchen", light: "medium" }],
  });
}

describe("a version bump never lands a plant as unreadable", () => {
  for (const from of [8, 9, 10]) {
    it(`version ${from} to ${VERSION}: every care style stays readable`, () => {
      const { data, issues } = importData(oldFile(from), { keepInvalid: true });
      assert.equal(invalidPlants(data).length, 0);
      assert.equal(data.plants.length, STYLES.length);
      assert.deepEqual(
        data.plants.map((p) => p.style),
        [...STYLES],
      );
      assert.equal(issues.length, 0);
    });
  }
  it("a newer file's known plants still read", () => {
    const { data } = importData(oldFile(VERSION + 1), { keepInvalid: true });
    assert.equal(invalidPlants(data).length, 0);
    assert.equal(data.plants.length, STYLES.length);
  });
});
