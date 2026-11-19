// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  careFill,
  lookAlikesOf,
  searchSpecies,
  toxicityText,
  type SpeciesRow,
} from "../src/index.ts";
import { SPECIES } from "../src/pilot-data.ts";

const ids = (q: string): string[] => searchSpecies(q, SPECIES).map((r) => r.id);

describe("species data (generated)", () => {
  it("carries names, synonyms, tags, toxicity and fields for the search and the modal", () => {
    const m = SPECIES.find((r) => r.id === "monstera-deliciosa");
    assert.ok(m);
    assert.ok(m.commonNames.includes("Swiss cheese plant"));
    assert.ok(Array.isArray(m.synonyms));
    assert.ok(m.tags.includes("indoor"));
    assert.equal(m.toxicity.status, "assessed");
    assert.equal(m.photoFile, "Monstera deliciosa 001.jpg");
    assert.ok((m.lookAlikes ?? []).length > 0);
    assert.ok((m.nameIdeas ?? []).length > 0);
    assert.match(m.careSource, /Penn State/);
  });

  it("species with no row have no lookAlikes field (not researched)", () => {
    const t = SPECIES.find((r) => r.id === "tillandsia");
    assert.equal(t?.lookAlikes, undefined);
  });
});

describe("searchSpecies", () => {
  it("matches a common name anywhere in the word", () => {
    assert.ok(ids("cheese").includes("monstera-deliciosa"));
    assert.ok(ids("EESE").includes("monstera-deliciosa"));
  });

  it("matches the scientific name and a genus alone", () => {
    assert.ok(ids("deliciosa").includes("monstera-deliciosa"));
    assert.ok(ids("dracaena").includes("dracaena-trifasciata"));
    assert.ok(ids("dracaena").includes("dracaena-marginata"));
  });

  it("matches synonyms", () => {
    const rows: SpeciesRow[] = [
      { ...(SPECIES[0] as SpeciesRow), id: "x", synonyms: ["Sansevieria trifasciata"] },
    ];
    assert.equal(searchSpecies("sansevieria", rows).length, 1);
  });

  it("ranks prefix matches before inner matches, and exact first", () => {
    const rows = [
      {
        ...(SPECIES[0] as SpeciesRow),
        id: "inner",
        commonNames: ["Big pothos"],
        scientificName: "A b",
      },
      {
        ...(SPECIES[0] as SpeciesRow),
        id: "prefix",
        commonNames: ["Pothos"],
        scientificName: "C d",
      },
      { ...(SPECIES[0] as SpeciesRow), id: "exact", commonNames: ["Pot"], scientificName: "E f" },
      {
        ...(SPECIES[0] as SpeciesRow),
        id: "prefix2",
        commonNames: ["Potted palm"],
        scientificName: "G h",
      },
    ];
    assert.deepEqual(
      searchSpecies("pot", rows).map((r) => r.id),
      ["exact", "prefix", "prefix2", "inner"],
    );
  });

  it("is case and accent insensitive, ignores extra spaces, and empty means no suggestions", () => {
    assert.ok(ids("  MONSTERA   deliciosa ").includes("monstera-deliciosa"));
    assert.deepEqual(ids(""), []);
    assert.deepEqual(ids("   "), []);
    assert.deepEqual(ids("zzzzqq"), []);
  });

  it("caps the list", () => {
    assert.ok(searchSpecies("a", SPECIES).length <= 8);
    assert.equal(searchSpecies("a", SPECIES, 3).length, 3);
  });
});

describe("careFill", () => {
  it("fills style, interval, tolerances and rest factor, and names the source", () => {
    const r = SPECIES.find((s) => s.id === "aloe-vera");
    assert.ok(r);
    const f = careFill(r);
    assert.equal(f.style, "let_fully_dry");
    assert.equal(f.intervalDays, r.intervalDays);
    assert.equal(f.restFactor, r.restFactor);
    assert.match(f.source, /Aloe vera/);
    assert.match(f.source, /unverified|not verified|checked/i);
  });

  it("leaves unknown values out instead of inventing them", () => {
    const r = { ...(SPECIES[0] as SpeciesRow), style: null, intervalDays: null };
    const f = careFill(r);
    assert.equal(f.style, undefined);
    assert.equal(f.intervalDays, undefined);
  });
});

describe("toxicityText", () => {
  it("never says safe when unknown", () => {
    assert.match(
      toxicityText({ status: "unknown", exposures: [] }),
      /not (yet )?assessed|unknown/i,
    );
    assert.doesNotMatch(toxicityText({ status: "unknown", exposures: [] }), /safe|non-toxic/i);
  });

  it("lists who is affected and how badly", () => {
    const t = toxicityText({
      status: "assessed",
      exposures: [
        { who: "cat", severity: 1 },
        { who: "dog", severity: 1 },
        { who: "child", severity: 0 },
      ],
    });
    assert.match(t, /cats/);
    assert.match(t, /dogs/);
    assert.doesNotMatch(t, /child/);
  });

  it("says no known effect when assessed with only severity 0", () => {
    assert.match(
      toxicityText({ status: "assessed", exposures: [{ who: "cat", severity: 0 }] }),
      /no (known )?(effect|harm)/i,
    );
  });
});

describe("lookAlikesOf", () => {
  it("resolves species ids to catalogue rows and keeps free-text ones", () => {
    const row = SPECIES.find((s) => s.id === "pilea-peperomioides");
    assert.ok(row);
    const la = lookAlikesOf(row, SPECIES);
    assert.ok(la.length >= 3);
    const jade = la.find((x) => x.species?.id === "crassula-ovata");
    assert.ok(jade, "jade resolves to a catalogue row (so it has a photo and can be switched to)");
    assert.ok(la.some((x) => x.species === undefined));
  });

  it("returns an empty list for a species that has none recorded", () => {
    const t = SPECIES.find((s) => s.id === "tillandsia");
    assert.ok(t);
    assert.deepEqual(lookAlikesOf(t, SPECIES), []);
  });
});

describe("toxicity for the household", () => {
  const tox = {
    status: "assessed",
    exposures: [
      { who: "cat", severity: 3 },
      { who: "dog", severity: 1 },
      { who: "child", severity: 2 },
    ],
  } as const;

  it("with no household set it lists everyone, as before", () => {
    assert.match(toxicityText(tox), /cats \(severe\).*dogs \(mild\).*children \(moderate\)/);
  });

  it("with pets set it speaks about them only", () => {
    const t = toxicityText(tox, { pets: ["cat"] });
    assert.match(t, /Toxic to cats \(severe\)/);
    assert.doesNotMatch(t, /dogs|children/);
  });

  it("children are included only when the household has them", () => {
    assert.match(
      toxicityText(tox, { pets: ["dog"], children: true }),
      /dogs \(mild\), children \(moderate\)/,
    );
  });

  it("says so when nothing listed is affected, without saying the plant is safe", () => {
    const t = toxicityText(
      { status: "assessed", exposures: [{ who: "dog", severity: 2 }] },
      { pets: ["cat"] },
    );
    assert.match(t, /No known effect on the pets or children you listed/);
    assert.doesNotMatch(t, /\bsafe\b/i);
  });

  it("unknown stays 'not assessed' whatever the household", () => {
    assert.match(
      toxicityText({ status: "unknown", exposures: [] }, { pets: ["cat"] }),
      /not assessed/i,
    );
  });

  it("a plant with no catalogue data reads 'Not assessed'", async () => {
    const { toxicityOfPlant } = await import("../src/index.ts");
    assert.equal(toxicityOfPlant({ species: "Made up plant" }, undefined), "Not assessed");
    assert.equal(toxicityOfPlant({}, { pets: ["cat"] }), "Not assessed");
    assert.match(
      toxicityOfPlant({ species: "Dieffenbachia seguine" }, { pets: ["cat"] }),
      /Toxic to cats \(severe\)/,
    );
  });
});
