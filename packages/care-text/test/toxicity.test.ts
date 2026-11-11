// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranslator } from "@green-garden/i18n";
import { toxicityLevel, toxicityText } from "../src/index.ts";

const en = createTranslator("en-GB");
const tox = (exposures: [string, number][]) =>
  ({
    status: "assessed",
    exposures: exposures.map(([who, severity]) => ({ who, severity })),
  }) as const;

describe("toxicity line", () => {
  it("never words 'not assessed' as safe", () => {
    const line = toxicityText(en, { status: "unknown", exposures: [] });
    assert.equal(
      line,
      "Toxicity not assessed yet; treat it as possibly harmful to pets and children.",
    );
    assert.doesNotMatch(line, /safe|non-toxic/i);
  });

  it("lists who is affected and how badly, worst first per group", () => {
    assert.equal(
      toxicityText(
        en,
        tox([
          ["cat", 1],
          ["dog", 2],
          ["cat", 3],
        ]),
      ),
      "Toxic to cats (severe), dogs (moderate).",
    );
  });

  it("says nothing known when every exposure is severity 0", () => {
    assert.equal(
      toxicityText(en, tox([["cat", 0]])),
      "No known effect on people or pets in the sources read.",
    );
  });

  it("with a household it speaks only about them", () => {
    const t = tox([
      ["cat", 1],
      ["dog", 2],
    ]);
    assert.equal(toxicityText(en, t, { pets: ["dog"] }), "Toxic to dogs (moderate).");
    assert.equal(
      toxicityText(en, t, { pets: ["small_pet"] }),
      "No known effect on the pets or children you listed in the sources read.",
    );
    assert.equal(toxicityText(en, t, { pets: [] }), "Toxic to cats (mild), dogs (moderate).");
  });

  it("counts children when they live there", () => {
    assert.equal(
      toxicityText(en, tox([["child", 1]]), { pets: [], children: true }),
      "Toxic to children (mild).",
    );
  });
});

describe("toxicity level", () => {
  it("is the highest severity, and undefined when not assessed", () => {
    assert.equal(toxicityLevel({ status: "unknown", exposures: [] }), undefined);
    assert.equal(toxicityLevel(tox([])), 0);
    assert.equal(
      toxicityLevel(
        tox([
          ["cat", 1],
          ["dog", 3],
        ]),
      ),
      3,
    );
  });
});

describe("assessed for people but not for pets", () => {
  const peopleOnly = tox([
    ["adult", 2],
    ["child", 2],
  ]);
  const note = "Not assessed for pets yet; treat it as possibly harmful.";

  it("says pets are not assessed beside the people grading, with no household", () => {
    assert.equal(
      toxicityText(en, peopleOnly),
      `Toxic to adults (moderate), children (moderate). ${note}`,
    );
    assert.equal(
      toxicityText(en, tox([["adult", 0]])),
      `No known effect on people in the sources read. ${note}`,
    );
  });

  it("tells a cat or dog household pets are not assessed, never 'no known effect'", () => {
    assert.equal(toxicityText(en, peopleOnly, { pets: ["cat"] }), note);
    assert.equal(toxicityText(en, tox([["adult", 0]]), { pets: ["dog"] }), note);
  });

  it("adds the pet note when a cat or dog household is hit through a person", () => {
    assert.equal(
      toxicityText(en, peopleOnly, { pets: ["cat"], children: true }),
      `Toxic to children (moderate). ${note}`,
    );
    assert.equal(
      toxicityText(en, peopleOnly, { pets: ["dog"], children: true }),
      `Toxic to children (moderate). ${note}`,
    );
  });

  it("stays quiet about pets for a household with children only", () => {
    assert.equal(
      toxicityText(en, peopleOnly, { pets: [], children: true }),
      "Toxic to children (moderate).",
    );
  });

  it("does not add the pet note when a cat or dog exposure exists", () => {
    assert.equal(
      toxicityText(
        en,
        tox([
          ["cat", 0],
          ["adult", 1],
        ]),
      ),
      "Toxic to adults (mild).",
    );
  });

  it("keeps the level for people", () => {
    assert.equal(toxicityLevel(peopleOnly), 2);
  });
});
