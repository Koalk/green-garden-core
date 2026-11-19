// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { seasonalPrompts, type PlantInput } from "@green-garden/engine";

// Citrus (calamondin), olive, fuchsia and pelargonium are frost-tender in pots: the catalogue tags
// them `tender`, and the seasonal bring-in card fires for them with no hardiness class to go on.
const IDS = [
  "citrus-x-microcarpa",
  "olea-europaea",
  "fuchsia-magellanica",
  "pelargonium-x-hortorum",
  "pelargonium-peltatum",
];

const entry = (id: string): { tags: { curated: string[] }; care: { hardiness?: unknown } } => {
  const url = new URL(`../catalogue-draft/${id}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(url, "utf8")) as { entries: never[] };
  return json.entries[0] as never;
};

describe("tender-tagged catalogue entries", () => {
  for (const id of IDS) {
    it(`${id}: tagged tender, and the autumn bring-in card fires`, () => {
      const e = entry(id);
      assert.ok(e.tags.curated.includes("tender"));
      const plant: PlantInput = {
        id: "p",
        style: "let_top_dry",
        intervalDays: 7,
        placement: "outdoor_pot",
      };
      const out = seasonalPrompts({
        plants: [plant],
        speciesOf: () => ({ tags: e.tags.curated }),
        home: { hemisphere: "north", latitude: 55 },
        weather: [],
        today: "2026-11-05",
        state: {},
      });
      assert.deepEqual(
        out.map((o) => o.kind),
        ["bring_in"],
      );
    });
  }
});
