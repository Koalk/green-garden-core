// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import { awayCare, awayCareHtml, awayStretches, type AwaySuggestion } from "../src/index.ts";

const STYLES = ["keep_moist", "let_top_dry", "let_fully_dry"] as const;
const LENGTHS = [1, 3, 4, 7, 10, 14, 20, 28, 40];

describe("away care suggestions (02b)", () => {
  it("never suggests a bath, matting or a reservoir for plants that like to dry out", () => {
    for (const style of ["let_fully_dry", "let_top_dry"] as const)
      for (const days of LENGTHS) {
        const s = awayCare(style, days);
        assert.ok(!s.includes("matting"), `${style} ${days}: matting`);
        assert.ok(!s.includes("reservoir"), `${style} ${days}: reservoir`);
      }
  });

  it("a fully-dry plant needs nothing for up to a week", () => {
    assert.deepEqual(awayCare("let_fully_dry", 3), ["nothing_needed"]);
    assert.deepEqual(awayCare("let_fully_dry", 7), ["nothing_needed"]);
  });

  it("a keep-moist plant gets matting and a reservoir from a week", () => {
    const s = awayCare("keep_moist", 7);
    for (const x of ["water_before", "cooler_spot", "pebble_tray", "matting", "reservoir"] as const)
      assert.ok(s.includes(x), x);
  });

  it("longer absences bring in a visitor, and over four weeks the plants go to a sitter's home", () => {
    for (const style of STYLES) {
      assert.ok(awayCare(style, 20).includes("sitter_visit"), style);
      assert.ok(awayCare(style, 40).includes("sitter_home"), style);
    }
    assert.ok(!awayCare("keep_moist", 3).includes("sitter_visit"));
  });

  it("every suggestion is a known key with a message", async () => {
    const { hasMessage } = await import("@green-garden/i18n");
    const seen = new Set<AwaySuggestion>();
    for (const style of STYLES)
      for (const d of LENGTHS) awayCare(style, d).forEach((x) => seen.add(x));
    for (const x of seen) assert.ok(hasMessage(`awaycare.s.${x}`), x);
  });
});

describe("away stretches", () => {
  it("groups consecutive away dates and ignores stretches that are over", () => {
    const s = awayStretches(
      ["2026-11-01", "2026-11-10", "2026-11-11", "2026-11-12", "2026-12-24"],
      "2026-11-05",
    );
    assert.deepEqual(s, [
      { from: "2026-11-10", to: "2026-11-12", days: 3 },
      { from: "2026-12-24", to: "2026-12-24", days: 1 },
    ]);
  });

  it("a stretch that has begun but not ended still counts, from today", () => {
    assert.deepEqual(awayStretches(["2026-11-04", "2026-11-05", "2026-11-06"], "2026-11-05"), [
      { from: "2026-11-05", to: "2026-11-06", days: 2 },
    ]);
  });
});

describe("away care section", () => {
  const base = emptyData();
  const data = {
    ...base,
    plants: [
      { id: "p1", spaceId: "space1", name: "Fern", style: "keep_moist", intervalDays: 4, logs: [] },
      {
        id: "p2",
        spaceId: "space1",
        name: "Snake",
        style: "let_fully_dry",
        intervalDays: 14,
        logs: [],
      },
    ],
    spaces: [
      {
        id: "space1",
        name: "Home",
        awayDates: [
          "2026-11-10",
          "2026-11-11",
          "2026-11-12",
          "2026-11-13",
          "2026-11-14",
          "2026-11-15",
          "2026-11-16",
          "2026-11-17",
        ],
      },
    ],
  } as const;

  it("lists suggestions per style for the next stretch, naming the plants", () => {
    const html = awayCareHtml(data, "2026-11-05");
    assert.match(html, /8 days/);
    assert.match(html, /Fern/);
    assert.match(html, /Snake/);
    assert.match(html, /capillary matting/);
    const snake = html.slice(html.indexOf("Snake"));
    assert.doesNotMatch(snake, /capillary matting/, "not offered for the fully-dry plant");
  });

  it("is empty without away days or plants", () => {
    assert.equal(awayCareHtml(emptyData(), "2026-11-05"), "");
    assert.equal(awayCareHtml({ ...data, plants: [] }, "2026-11-05"), "");
  });
});
