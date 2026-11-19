// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyData, type AppData } from "@green-garden/storage";
import { healthTexts } from "../src/health.ts";
import { SPECIES } from "../src/pilot-data.ts";

const row = SPECIES.find((s) => s.commonNames.length > 0);
const data = (): AppData => ({
  ...emptyData(),
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Mine",
      ...(row === undefined ? {} : { species: row.scientificName }),
      style: "keep_moist",
      intervalDays: 6,
    },
  ],
});

describe("Ask about a problem on a plant's details", () => {
  it("builds the chat prompt and the search text from the plant, with the typed symptoms", () => {
    assert.ok(row);
    const r = healthTexts(data(), "p1", "2026-11-08", "brown tips");
    assert.ok(r);
    assert.match(r.chat, new RegExp(row.scientificName));
    assert.match(r.chat, /^Symptoms: brown tips$/m);
    assert.ok(r.search.startsWith(row.scientificName));
    assert.match(r.search, /brown tips$/);
  });
  it("is undefined for an unknown plant", () => {
    assert.equal(healthTexts(data(), "x", "2026-11-08", ""), undefined);
  });
  it("the plant card has the symptoms field and two copy buttons, and copies only", () => {
    const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.match(src, /data-action="health-copy"/);
    assert.match(src, /data-action="health-search"/);
    assert.match(src, /name="symptoms"/);
    assert.match(src, /navigator\.clipboard/);
    assert.match(src, /healthcheck\.copied/);
  });
});
