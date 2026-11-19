// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, type AppData, type PlantDraft } from "@green-garden/storage";
import {
  ADJECTIVES,
  NOUNS,
  addPlant,
  deleteDraft,
  draftFields,
  hasUnsavedChanges,
  nextName,
  plantFromFields,
  saveDraft,
  validatePlantFields,
  type SpeciesRow,
} from "../src/index.ts";
import { SPECIES } from "../src/pilot-data.ts";

const row = (id: string): SpeciesRow => {
  const r = SPECIES.find((s) => s.id === id);
  assert.ok(r);
  return r;
};

const list = (d: AppData): readonly PlantDraft[] => d.drafts ?? [];

/** Deterministic random source for the tests. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("drafts", () => {
  const fields = { species: "Monstera deliciosa", plantName: "Monty" };

  it("saveDraft stores the raw fields, keeps plants untouched and never schedules", () => {
    const d = saveDraft(emptyData(), fields, "2026-10-28");
    assert.equal(list(d).length, 1);
    assert.equal(list(d)[0]?.id, "d1");
    assert.deepEqual(list(d)[0]?.fields, fields);
    assert.equal(d.plants.length, 0);
  });

  it("saving again with the same id replaces that draft instead of adding another", () => {
    let d = saveDraft(emptyData(), fields, "2026-10-28");
    d = saveDraft(d, { ...fields, plantName: "Monty 2" }, "2026-10-29", "d1");
    assert.equal(list(d).length, 1);
    assert.equal(list(d)[0]?.fields["plantName"], "Monty 2");
    assert.equal(list(d)[0]?.savedOn, "2026-10-29");
  });

  it("new drafts get fresh ids", () => {
    let d = saveDraft(emptyData(), fields, "2026-10-28");
    d = saveDraft(d, fields, "2026-10-28");
    assert.deepEqual(
      list(d).map((x) => x.id),
      ["d1", "d2"],
    );
  });

  it("deleteDraft removes it, and the last removal drops the key", () => {
    const d = deleteDraft(saveDraft(emptyData(), fields, "2026-10-28"), "d1");
    assert.equal("drafts" in d, false);
  });

  it("draftFields finds a draft's values", () => {
    const d = saveDraft(emptyData(), fields, "2026-10-28");
    assert.deepEqual(draftFields(d, "d1"), fields);
    assert.deepEqual(draftFields(d, "nope"), {});
  });

  it("hasUnsavedChanges ignores whitespace and empty-vs-missing", () => {
    assert.equal(hasUnsavedChanges({ a: "x", b: "" }, { a: " x ", c: "" }), false);
    assert.equal(hasUnsavedChanges({ a: "x" }, { a: "y" }), true);
    assert.equal(hasUnsavedChanges({}, { plantName: "Monty" }), true);
  });
});

describe("plantFromFields and validatePlantFields", () => {
  const ok = { plantName: "Monty", style: "let_top_dry", intervalDays: "7" };

  it("builds a plant from form values, optional ones only when filled", () => {
    const p = plantFromFields(
      { ...ok, species: "Monstera deliciosa", potDiameterCm: "14", roomId: "r1", restFactor: "" },
      undefined,
    );
    assert.equal(p.name, "Monty");
    assert.equal(p.species, "Monstera deliciosa");
    assert.equal(p.potDiameterCm, 14);
    assert.equal(p.roomId, "r1");
    assert.equal("restFactor" in p, false);
  });

  it("keeps the engine's fields when editing", () => {
    const old = {
      id: "p1",
      spaceId: "space1",
      ...ok,
      name: "Monty",
      style: "let_top_dry" as const,
      intervalDays: 7,
      logs: [],
      doneStreak: 3,
    };
    assert.equal(plantFromFields(ok, old).doneStreak, 3);
  });

  it("requires a name, a style and an interval of at least 1 day", () => {
    assert.deepEqual(validatePlantFields(ok), []);
    assert.equal(validatePlantFields({ ...ok, plantName: " " }).length, 1);
    assert.equal(validatePlantFields({ ...ok, style: "" }).length, 1);
    assert.equal(validatePlantFields({ ...ok, intervalDays: "0" }).length, 1);
    assert.equal(validatePlantFields({}).length, 3);
  });

  it("a plant saved from the modal is scheduled; a draft is not", () => {
    const d0: AppData = emptyData();
    const withDraft = saveDraft(d0, ok, "2026-10-28");
    assert.equal(withDraft.plants.length, 0);
    const saved = addPlant(deleteDraft(withDraft, "d1"), plantFromFields(ok, undefined));
    assert.equal(saved.plants.length, 1);
    assert.equal("drafts" in saved, false);
  });
});

describe("nextName", () => {
  it("never repeats within a session, over hundreds of draws", () => {
    const used = new Set<string>();
    const r = lcg(1);
    for (let i = 0; i < 400; i += 1) {
      const n = nextName(row("monstera-deliciosa"), used, r);
      assert.ok(!used.has(n.toLowerCase()), `repeated ${n} at ${i}`);
      used.add(n.toLowerCase());
    }
  });

  it("prefers the species' own name ideas first", () => {
    const ideas = (row("monstera-deliciosa").nameIdeas ?? []).map((x) => x.toLowerCase());
    assert.ok(ideas.length > 0);
    const used = new Set<string>();
    const r = lcg(2);
    for (let i = 0; i < ideas.length; i += 1) {
      const n = nextName(row("monstera-deliciosa"), used, r);
      assert.ok(ideas.includes(n.toLowerCase()), `${n} is not one of ${ideas.join(", ")}`);
      used.add(n.toLowerCase());
    }
  });

  it("after the ideas run out it builds names from the species' own words", () => {
    const r0 = row("monstera-deliciosa");
    const used = new Set((r0.nameIdeas ?? []).map((x) => x.toLowerCase()));
    const r = lcg(3);
    const words = ["mon", "del", "swi", "che"];
    for (let i = 0; i < 6; i += 1) {
      const n = nextName(r0, used, r);
      assert.ok(
        words.some((w) => n.toLowerCase().includes(w)),
        `${n} does not mention the species`,
      );
      used.add(n.toLowerCase());
    }
  });

  it("uses the trait: a trailing plant gets trailing wordplay available", () => {
    const pothos = row("epipremnum-aureum");
    assert.ok(pothos.tags.includes("trailing"));
    const used = new Set((pothos.nameIdeas ?? []).map((x) => x.toLowerCase()));
    const seen = new Set<string>();
    const r = lcg(4);
    for (let i = 0; i < 60; i += 1) {
      const n = nextName(pothos, used, r);
      used.add(n.toLowerCase());
      seen.add(n);
    }
    assert.ok(
      [...seen].some((n) => /trail|dangl|vine|rapunzel|swing/i.test(n)),
      [...seen].join(", "),
    );
  });

  it("falls back to general names for an unknown plant, and the general lists are large", () => {
    assert.ok(ADJECTIVES.length >= 40 && NOUNS.length >= 40);
    const used = new Set<string>();
    const r = lcg(5);
    for (let i = 0; i < 100; i += 1) {
      const n = nextName(undefined, used, r);
      assert.match(n, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
      assert.ok(!used.has(n.toLowerCase()));
      used.add(n.toLowerCase());
    }
  });

  it("is deterministic for a given random source", () => {
    assert.equal(nextName(undefined, new Set(), lcg(9)), nextName(undefined, new Set(), lcg(9)));
  });

  it("names are plain: letters, spaces, apostrophes and hyphens only", () => {
    const used = new Set<string>();
    const r = lcg(6);
    for (const s of SPECIES)
      for (let i = 0; i < 30; i += 1) {
        const n = nextName(s, used, r);
        used.add(n.toLowerCase());
        assert.match(n, /^[\p{L}][\p{L} '’-]*$/u, n);
      }
  });
});

describe("fields the form does not edit are kept", () => {
  it("keeps lastRepotted and growthClass and maps the pot type", () => {
    const old = {
      id: "p1",
      spaceId: "space1",
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      logs: [],
      lastRepotted: "2026-03-01",
      growthClass: "slow",
    } as const;
    const p = plantFromFields(
      { plantName: "Fern", style: "keep_moist", intervalDays: "4", drainage: "no_hole" },
      old,
    );
    assert.equal(p.lastRepotted, "2026-03-01");
    assert.equal(p.growthClass, "slow");
    assert.equal(p.drainage, "no_hole");
    assert.equal(
      plantFromFields({ plantName: "F", drainage: "moat", intervalDays: "3" }, undefined).drainage,
      undefined,
    );
  });
});
