// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_REGIONS,
  QUESTIONS,
  followUpFor,
  homeFor,
  rankQuestions,
  type QuestionPlant,
  type QuestionText,
} from "../src/index.ts";

const TODAY = "2026-06-10";
const LOCALES = ["en-GB", "es", "it"] as const;

const plant = (extra: Partial<QuestionPlant> = {}): QuestionPlant => ({
  id: "g1",
  addedOn: "2026-01-01",
  waterings: 2,
  ...extra,
});
const list = (p: QuestionPlant) => rankQuestions(p, TODAY, {}, { mode: "list" }).map((q) => q.id);
const push = (p: QuestionPlant) =>
  rankQuestions(p, TODAY, {}, { mode: "voluntary" }).map((q) => q.id);

describe("in-ground questions Q-K2, Q-K5, Q-K6 (02k section 5)", () => {
  it("are in the bank with plain wording in en-GB, es and it", () => {
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER"]) {
      const q = QUESTIONS.find((x) => x.id === id);
      assert.ok(q, id);
      for (const l of LOCALES) {
        const text: QuestionText = q.text[l];
        assert.ok(text.question.length > 0, `${id} ${l}`);
        for (const o of q.options) assert.ok((text.options[o] ?? "").length > 0, `${id} ${l} ${o}`);
      }
      // every answer set has an "I don't know" that keeps the assumed default
      assert.ok(q.options.includes("not_sure"), id);
    }
  });

  it("are never asked about an indoor plant", () => {
    const indoor = list(plant({ placement: "indoor" }));
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER"]) assert.ok(!indoor.includes(id), id);
  });

  it("a plant in the ground gets all three, planting date and soil before the rest", () => {
    const order = list(plant({ placement: "ground" }));
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER", "Q-GROUND"]) assert.ok(order.includes(id));
    const tierB = push(plant({ placement: "ground" })).filter((id) =>
      ["Q-PLANTED", "Q-GROUND", "Q-MULCH", "Q-COVER", "Q-ROOM"].includes(id),
    );
    // "now" questions come first inside the tier: Q-K2 and Q-K3 move up when the user picks ground
    assert.deepEqual([...tierB.slice(0, 2)].sort(), ["Q-GROUND", "Q-PLANTED"]);
  });

  it("a pot outside is asked about cover, not the planting date or mulch", () => {
    const order = list(plant({ placement: "outdoor_pot" }));
    assert.ok(order.includes("Q-COVER"));
    assert.ok(!order.includes("Q-PLANTED") && !order.includes("Q-MULCH"));
  });

  it("stop being asked once the user has answered", () => {
    const answered = plant({
      placement: "ground",
      plantedOn: "2026-03-01",
      mulched: true,
      sheltered: false,
      fieldSources: { plantedOn: "user", mulched: "user", sheltered: "user" },
    });
    const order = list(answered);
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER"]) assert.ok(!order.includes(id), id);
  });

  it("an assumed value stays open", () => {
    const assumed = plant({
      placement: "ground",
      mulched: false,
      fieldSources: { mulched: "default" },
    });
    assert.ok(list(assumed).includes("Q-MULCH"));
  });
});

describe("Q-K0: the home question (02k 8.5, and 2)", () => {
  it("covers every row of the 8.5 table", () => {
    assert.equal(HOME_REGIONS.filter((r) => r.country === "GB").length, 4);
    assert.equal(HOME_REGIONS.filter((r) => r.country === "ES").length, 11);
    const ids = HOME_REGIONS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("has wording in every language for each region, follow-up and option", () => {
    for (const r of HOME_REGIONS) {
      for (const l of LOCALES) {
        assert.ok(r.label[l].length > 0, `${r.id} ${l}`);
        for (const f of r.followUps) {
          assert.ok(f.question[l].length > 0, `${r.id}/${f.id} ${l}`);
          for (const o of f.options) assert.ok(o.label[l].length > 0, `${f.id}/${o.id} ${l}`);
        }
      }
    }
  });

  it("suggests the climate and winter minimum of the table", () => {
    assert.deepEqual(homeFor("gb-scotland-east"), { climate: "oceanic_dry", winterMin: "H4" });
    assert.deepEqual(homeFor("gb-wales-nw-sw"), { climate: "oceanic_wet", winterMin: "H4" });
    assert.deepEqual(homeFor("es-madrid-clm-extremadura"), {
      climate: "mediterranean",
      winterMin: "H5",
    });
    assert.deepEqual(homeFor("es-aragon-ebro"), { climate: "semi_arid", winterMin: "H5" });
    assert.deepEqual(homeFor("es-lanzarote-fuerteventura"), { climate: "arid", winterMin: "H1c" });
    assert.deepEqual(homeFor("es-ibiza"), { climate: "semi_arid", winterMin: "H3" });
  });

  it("follow-ups change the suggestion", () => {
    assert.deepEqual(homeFor("gb-scotland-west", "high"), { climate: "mountain", winterMin: "H5" });
    assert.deepEqual(homeFor("gb-scotland-west", "low"), {
      climate: "oceanic_wet",
      winterMin: "H4",
    });
    assert.deepEqual(homeFor("es-galicia-cantabrian", "inland"), {
      climate: "med_mild",
      winterMin: "H4",
    });
    assert.deepEqual(homeFor("es-andalusia-inland", "mountain"), {
      climate: "mountain",
      winterMin: "H5",
    });
    assert.deepEqual(homeFor("es-murcia-almeria-alicante", "coast"), {
      climate: "arid",
      winterMin: "H2",
    });
  });

  it("the Canaries ask for the side and the height, five islands only", () => {
    assert.equal(HOME_REGIONS.filter((r) => r.id.startsWith("es-canary-")).length, 1);
    assert.equal(homeFor("es-canary-high-islands"), undefined, "no answer without the follow-ups");
    const side = followUpFor("es-canary-high-islands");
    assert.deepEqual(
      side.map((f) => f.id),
      ["side", "height"],
    );
    const go = (side: string, height: string) => homeFor("es-canary-high-islands", side, height);
    assert.deepEqual(go("north", "coast"), { climate: "mediterranean", winterMin: "H1c" });
    assert.deepEqual(go("north", "middle"), { climate: "med_mild", winterMin: "H2" });
    assert.deepEqual(go("south", "coast"), { climate: "arid", winterMin: "H1c" });
    assert.deepEqual(go("south", "middle"), { climate: "semi_arid", winterMin: "H2" });
    assert.deepEqual(go("north", "high"), { climate: "mountain", winterMin: "H4" });
    assert.deepEqual(go("south", "high"), { climate: "mountain", winterMin: "H4" });
  });

  it("an unknown region or follow-up answer gives no suggestion", () => {
    assert.equal(homeFor("nowhere"), undefined);
    assert.deepEqual(homeFor("gb-scotland-west", "sideways"), {
      climate: "oceanic_wet",
      winterMin: "H4",
    });
  });
});
