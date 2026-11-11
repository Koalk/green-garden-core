// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-plus-operands -- tests poke into untyped JSON */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Watering intervals of the most common houseplants, checked against written sources.
// Every value is for the stated pot and season: a 13 cm pot in bright indirect light at room
// temperature, in the growing season (spring to early autumn, mid latitudes). The rest-season
// factor, not these numbers, stretches the interval in winter.
const POT = "13 cm pot, bright indirect light, room temperature, growing season";

interface Pin {
  id: string;
  interval: number;
  confidence: "checked" | "from_knowledge_verify" | "guess";
  /** Sources behind the interval: the source plus corroboratedBy. */
  sources: number;
  dryTol: number;
  wetTol: number;
}

const PINS: Pin[] = [
  {
    id: "dracaena-trifasciata",
    interval: 14,
    confidence: "checked",
    sources: 2,
    dryTol: 14,
    wetTol: 3,
  },
  {
    id: "chlorophytum-comosum",
    interval: 7,
    confidence: "checked",
    sources: 2,
    dryTol: 5,
    wetTol: 4,
  },
  {
    id: "spathiphyllum-wallisii",
    interval: 5,
    confidence: "guess",
    sources: 1,
    dryTol: 2,
    wetTol: 3,
  },
  {
    id: "zamioculcas-zamiifolia",
    interval: 14,
    confidence: "checked",
    sources: 2,
    dryTol: 21,
    wetTol: 3,
  },
  { id: "crassula-ovata", interval: 14, confidence: "checked", sources: 2, dryTol: 14, wetTol: 3 },
  { id: "epipremnum-aureum", interval: 8, confidence: "checked", sources: 3, dryTol: 7, wetTol: 3 },
  {
    id: "monstera-deliciosa",
    interval: 7,
    confidence: "checked",
    sources: 2,
    dryTol: 5,
    wetTol: 4,
  },
  {
    id: "ficus-elastica",
    interval: 8,
    confidence: "from_knowledge_verify",
    sources: 1,
    dryTol: 5,
    wetTol: 4,
  },
  { id: "aloe-vera", interval: 14, confidence: "checked", sources: 2, dryTol: 14, wetTol: 3 },
  {
    id: "pilea-peperomioides",
    interval: 7,
    confidence: "from_knowledge_verify",
    sources: 1,
    dryTol: 5,
    wetTol: 3,
  },
];

const entry = (id: string): any =>
  JSON.parse(readFileSync(new URL(`../../../catalogue-draft/${id}.json`, import.meta.url), "utf8"))
    .entries[0];

describe("houseplant intervals (top 30, part 1)", () => {
  for (const p of PINS) {
    it(`${p.id}: ${p.interval} days for a ${POT}`, () => {
      const e = entry(p.id);
      const c = e.care;
      assert.equal(c.baseIntervalDays.value, p.interval);
      assert.equal(c.baseIntervalDays.confidence, p.confidence);
      assert.equal(1 + (c.baseIntervalDays.corroboratedBy?.length ?? 0), p.sources);
      assert.notEqual(c.baseIntervalDays.source, "author");
      assert.equal(c.dryToleranceDays.value, p.dryTol);
      assert.equal(c.wetToleranceDays.value, p.wetTol);
      assert.match(e.provenance.notes, /Interval:/, "wording and conversion are recorded");
      assert.match(e.provenance.notes, /13 cm pot/, "pot assumption is recorded");
    });
  }
});
