// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const load = (tag: string): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../src/locales/${tag}.json`, import.meta.url), "utf8"),
  ) as Record<string, string>;
const CLASSES = [
  "oceanic_wet",
  "oceanic_dry",
  "med_mild",
  "mediterranean",
  "semi_arid",
  "arid",
  "mountain",
];

const LEADS: Record<string, string[]> = {
  "en-GB": ["Very wet", "Wet", "Mild", "Dry", "Very dry", "Desert"],
  es: ["Muy húmedo", "Húmedo", "Suave", "Seco", "Muy seco", "Desierto"],
  it: ["Molto piovoso", "Piovoso", "Mite", "Asciutto", "Molto asciutto", "Deserto"],
};

describe("climate class labels say what they mean", () => {
  for (const tag of ["en-GB", "es", "it"]) {
    const cat = load(tag);
    it(`${tag}: every class has a label, all different`, () => {
      const labels = CLASSES.map((c) => cat[`home.climate.${c}`]);
      assert.ok(labels.every((l) => typeof l === "string" && l !== ""));
      assert.equal(new Set(labels).size, CLASSES.length);
    });
    it(`${tag}: the two oceanic classes carry their rain figure, and nothing is called drier`, () => {
      assert.match(cat["home.climate.oceanic_wet"] ?? "", /1[.,]?000/);
      assert.match(cat["home.climate.oceanic_dry"] ?? "", /800/);
      for (const c of CLASSES) {
        assert.doesNotMatch(
          cat[`home.climate.${c}`] ?? "",
          /drier|más bien seco|piuttosto asciutto/i,
          c,
        );
      }
    });
    it(`${tag}: labels run wet to dry in order, no UK class is called dry`, () => {
      const lead = LEADS[tag] ?? [];
      const order = [
        "oceanic_wet",
        "oceanic_dry",
        "med_mild",
        "mediterranean",
        "semi_arid",
        "arid",
      ];
      order.forEach((c, i) => {
        const label = cat[`home.climate.${c}`] ?? "";
        assert.ok(
          label.startsWith(lead[i] ?? "?"),
          `${c}: "${label}" should start with "${lead[i]}"`,
        );
      });
      for (const c of ["oceanic_wet", "oceanic_dry"]) {
        assert.doesNotMatch(
          cat[`home.climate.${c}`] ?? "",
          /^(very )?dry|^(muy )?seco|^(molto )?asciutto/i,
          c,
        );
      }
    });
  }
});
