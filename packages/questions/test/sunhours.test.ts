// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QUESTIONS, rankQuestions, type QuestionPlant, type QuestionText } from "../src/index.ts";

// Q-SUNHOURS replaces the sun half of Q-GROUND, which then asks soil only.

const TODAY = "2026-06-10";
const LOCALES = ["en-GB", "es", "it"] as const;
const plant = (extra: Partial<QuestionPlant> = {}): QuestionPlant => ({
  id: "g1",
  addedOn: "2026-01-01",
  waterings: 2,
  ...extra,
});
const list = (p: QuestionPlant) => rankQuestions(p, TODAY, {}, { mode: "list" }).map((q) => q.id);
const byId = (id: string) => QUESTIONS.find((q) => q.id === id);

describe("Q-SUNHOURS", () => {
  const q = byId("Q-SUNHOURS");

  it("is a tier B question that sets directSun", () => {
    assert.ok(q);
    assert.equal(q.tier, "B");
    assert.equal(q.weight, 2);
    assert.deepEqual(q.updates, ["directSun"]);
    assert.deepEqual(q.options, [
      "morning",
      "midday",
      "afternoon",
      "morning_afternoon",
      "most_of_day",
      "none",
      "not_sure",
    ]);
  });

  it("has plain wording in en-GB, es and it for the question and every option", () => {
    assert.ok(q);
    for (const l of LOCALES) {
      const t: QuestionText = q.text[l];
      assert.ok(t.question.length > 0, l);
      for (const o of q.options) assert.ok((t.options[o] ?? "").length > 0, `${l} ${o}`);
    }
    assert.equal(q.text["en-GB"].question, "When does it usually get direct sun?");
  });

  it("is asked outdoors (pot or ground) and never indoors", () => {
    assert.ok(list(plant({ placement: "ground" })).includes("Q-SUNHOURS"));
    assert.ok(list(plant({ placement: "outdoor_pot" })).includes("Q-SUNHOURS"));
    assert.ok(!list(plant({ placement: "indoor" })).includes("Q-SUNHOURS"));
    assert.ok(!list(plant()).includes("Q-SUNHOURS"));
  });

  it("is not asked once directSun is known, an empty list included", () => {
    const base = { placement: "outdoor_pot" } as const;
    assert.ok(!list(plant({ ...base, directSun: [{ from: 7, to: 11 }] })).includes("Q-SUNHOURS"));
    assert.ok(!list(plant({ ...base, directSun: [] })).includes("Q-SUNHOURS"));
    const assumed = plant({
      ...base,
      directSun: [{ from: 7, to: 11 }],
      fieldSources: { directSun: "default" },
    });
    assert.ok(list(assumed).includes("Q-SUNHOURS"));
  });
});

describe("Q-GROUND asks soil only", () => {
  const q = byId("Q-GROUND");

  it("updates the soil and offers no sun options", () => {
    assert.ok(q);
    assert.deepEqual(q.updates, ["groundSoil"]);
    assert.deepEqual(q.options, ["sandy", "loam", "clay", "not_sure"]);
    assert.equal(q.text["en-GB"].question, "What soil is it in?");
  });

  it("is open until the soil is known, whatever the sun answer is", () => {
    const g = { placement: "ground" } as const;
    assert.ok(list(plant({ ...g, sun: "full_sun" })).includes("Q-GROUND"));
    assert.ok(!list(plant({ ...g, groundSoil: "clay" })).includes("Q-GROUND"));
  });
});
