// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { toxicityLevel, toxicityPopupHtml, toxicityPopupOfPlant } from "../src/index.ts";
import type { SpeciesRow } from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const tox = {
  status: "assessed",
  exposures: [
    { who: "cat", severity: 3 },
    { who: "dog", severity: 1 },
    { who: "child", severity: 2 },
    { who: "adult", severity: 0 },
  ],
} as const;

describe("toxicity level and popup", () => {
  it("the level is the highest severity of any exposure; unknown has none", () => {
    assert.equal(toxicityLevel(tox), 3);
    assert.equal(toxicityLevel({ status: "assessed", exposures: [] }), 0);
    assert.equal(
      toxicityLevel({ status: "unknown", exposures: [{ who: "cat", severity: 3 }] }),
      undefined,
    );
  });

  it("the summary shows the highest level, the body lists every exposure with what it means", () => {
    const html = toxicityPopupHtml(tox);
    assert.match(html, /<summary>[^<]*level 3[^<]*severe/i);
    for (const who of ["cats", "dogs", "children", "adults"]) assert.match(html, new RegExp(who));
    assert.equal([...html.matchAll(/<li>/g)].length, 4);
    assert.match(html, /emergency|vet|poison/i);
    assert.doesNotMatch(html, /tox\.|^\s*undefined/);
  });

  it("unknown is never worded as safe and has no popup list", () => {
    const html = toxicityPopupHtml({ status: "unknown", exposures: [] });
    assert.match(html, /not assessed/i);
    assert.doesNotMatch(html, /<li>|\bsafe\b/i);
  });

  it("is translated", () => {
    setLocale("es");
    assert.doesNotMatch(toxicityPopupHtml(tox), /tox\.|level/i);
  });

  it("finds the entry of a stored plant by name, else says not assessed", () => {
    const rows = [
      {
        id: "x",
        name: "Kalanchoe",
        scientificName: "Kalanchoe blossfeldiana",
        commonNames: [],
        synonyms: [],
        toxicity: tox,
      },
    ] as unknown as readonly SpeciesRow[];
    assert.match(toxicityPopupOfPlant({ species: "kalanchoe blossfeldiana" }, rows), /level 3/i);
    assert.match(toxicityPopupOfPlant({ species: "mystery" }, rows), /not assessed/i);
  });
});

describe("app.ts wiring", () => {
  it("puts the popup on the plant card", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
    assert.match(src, /\$\{toxicityPopupOfPlant\(p\)\}/);
  });
});
