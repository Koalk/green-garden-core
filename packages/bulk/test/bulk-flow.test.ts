// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, assumedMarginDays, makePlan } from "@green-garden/storage";
import {
  advance,
  bulkDraftText,
  clearBulkDraft,
  goBack,
  groupRows,
  isBulkDraft,
  makeMatcher,
  parseTyped,
  pickCandidate,
  placementOf,
  removeRow,
  retype,
  runMatch,
  saveBulk,
  saveBulkDraft,
  sameAsAbove,
  setRowPlacement,
  setRowRoom,
  setText,
  setWatered,
  startBulk,
  toggleRow,
  typedCount,
  useGeneric,
  type BulkState,
} from "../src/index.ts";
import { SPECIES } from "./species.ts";

const TODAY = "2026-10-30";
const en = makeMatcher(SPECIES, "en-GB");
const es = makeMatcher(SPECIES, "es");

const first = <T>(xs: readonly T[] | undefined): T => {
  const x = xs?.[0];
  assert.ok(x);
  return x;
};
const matched = (text: string, matcher = en): BulkState => runMatch(startBulk(text), matcher);
const row = (s: BulkState, i = 0) => {
  const r = s.rows[i];
  assert.ok(r);
  return r;
};

describe("parseTyped: step 1, one plant per line or comma separated", () => {
  const cases: [string, [string, number][]][] = [
    ["pothos", [["pothos", 1]]],
    [
      "pothos\nsnake plant",
      [
        ["pothos", 1],
        ["snake plant", 1],
      ],
    ],
    [
      "pothos, snake plant ,jade",
      [
        ["pothos", 1],
        ["snake plant", 1],
        ["jade", 1],
      ],
    ],
    [
      "pothos; jade",
      [
        ["pothos", 1],
        ["jade", 1],
      ],
    ],
    ["3x pothos", [["pothos", 3]]],
    ["3 x pothos", [["pothos", 3]]],
    ["pothos x3", [["pothos", 3]]],
    ["2 jade", [["jade", 2]]],
    [
      "- aloe\n* fern\n1. rose",
      [
        ["aloe", 1],
        ["fern", 1],
        ["rose", 1],
      ],
    ],
    ["\n\n  \n", []],
    ["", []],
    ["pothos,,\n,", [["pothos", 1]]],
    [
      "CRLF\r\nlines",
      [
        ["CRLF", 1],
        ["lines", 1],
      ],
    ],
    ["Geranio", [["Geranio", 1]]],
    ["lengua de suegra", [["lengua de suegra", 1]]],
    ["Café plant", [["Café plant", 1]]],
  ];
  for (const [text, want] of cases) {
    it(JSON.stringify(text), () => {
      assert.deepEqual(
        parseTyped(text).map((p) => [p.input, p.count]),
        want,
      );
    });
  }

  it("does not split on 'and', 'y', 'e' or '&'", () => {
    for (const text of ["pothos and ivy", "pothos y hiedra", "pothos e edera", "pothos & ivy"]) {
      assert.equal(parseTyped(text).length, 1, text);
    }
  });

  it("counts plants, not lines", () => {
    assert.equal(typedCount("3x pothos\njade, aloe\n"), 5);
    assert.equal(typedCount(""), 0);
  });

  it("caps one line at 99 plants", () => {
    assert.equal(typedCount("500x pothos"), 99);
  });
});

describe("runMatch and groupRows: step 2", () => {
  it("groups rows as sure, choose and unmatched", () => {
    const s = matched("aloe vera\nxyzzy\npothos\n3x monstera");
    const g = groupRows(s);
    assert.deepEqual(
      g.sure.map((r) => r.input),
      ["aloe vera", "monstera"],
    );
    assert.deepEqual(
      g.choose.map((r) => r.input),
      ["pothos"],
    );
    assert.deepEqual(
      g.unmatched.map((r) => r.input),
      ["xyzzy"],
    );
    assert.equal(s.step, "match");
  });

  it("keeps the count of '3x monstera' on the row", () => {
    assert.equal(row(matched("3x monstera"), 0).count, 3);
  });

  it("a full name with a look-alike is a choose, with the candidates and their tell", () => {
    const r = row(matched("pothos"));
    assert.equal(r.verdict, "choose");
    assert.ok(r.candidates.length >= 2);
    assert.ok(r.candidates.some((c) => c.id === "epipremnum-aureum"));
    assert.ok(r.candidates.some((c) => c.tell !== undefined && c.tell !== ""));
    assert.equal(r.speciesId, undefined);
  });

  it("'geranio' (Spanish for the garden geranium) is a choose, never a silent pick of the hardy geranium", () => {
    for (const m of [en, es]) {
      const r = row(matched("geranio", m));
      assert.equal(r.verdict, "choose");
      assert.ok(r.candidates.some((c) => c.id.startsWith("pelargonium")));
      // The hardy cranesbill is the one non-pelargonium that may be offered beside them.
      assert.ok(
        r.candidates.every((c) => c.id.startsWith("pelargonium") || c.id === "geranium-rozanne"),
      );
    }
  });

  it("a typo ('monstra') is matched, an accent or capital is ignored", () => {
    assert.equal(row(matched("monstra")).speciesId, "monstera-deliciosa");
    assert.equal(row(matched("  ALOE   Vera ")).speciesId, "aloe-vera");
  });

  it("the user's locale comes first: Spanish names match as exact in es", () => {
    const withEs = SPECIES.find((r) => r.localNames?.some((n) => n.lang === "es"));
    assert.ok(withEs, "the catalogue has a Spanish name");
    const name = withEs.localNames?.find((n) => n.lang === "es")?.name ?? "";
    const r = row(matched(name, es));
    assert.equal(r.verdict === "none", false);
    assert.equal(r.candidates[0]?.id, withEs.id);
    assert.equal(r.candidates[0].reason, "exact");
  });

  it("the sure rows are preselected, the choose and unmatched rows are not", () => {
    const s = matched("aloe vera\npothos\nxyzzy");
    assert.equal(row(s, 0).speciesId, "aloe-vera");
    assert.equal(row(s, 1).speciesId, undefined);
    assert.equal(row(s, 2).speciesId, undefined);
  });

  it("empty text matches nothing and stays on step 1", () => {
    assert.equal(matched("   ").step, "type");
  });
});

describe("resolving rows", () => {
  it("picking a candidate moves a choose row to sure and marks it user-confirmed", () => {
    let s = matched("pothos");
    s = pickCandidate(s, row(s).id, "epipremnum-aureum");
    assert.equal(row(s).speciesId, "epipremnum-aureum");
    assert.equal(row(s).confirmed, true);
    assert.equal(groupRows(s).choose.length, 0);
    assert.equal(groupRows(s).sure.length, 1);
  });

  it("only a listed candidate can be picked", () => {
    let s = matched("pothos");
    s = pickCandidate(s, row(s).id, "aloe-vera");
    assert.equal(row(s).speciesId, undefined);
  });

  it("an unmatched row can be retyped and matched again", () => {
    let s = matched("xyzzy");
    s = retype(s, row(s).id, "aloe vera", en);
    assert.equal(row(s).input, "aloe vera");
    assert.equal(row(s).speciesId, "aloe-vera");
    assert.equal(groupRows(s).unmatched.length, 0);
  });

  it("retyping keeps the count the row had", () => {
    let s = matched("3x xyzzy");
    s = retype(s, row(s).id, "aloe vera", en);
    assert.equal(row(s).count, 3);
  });

  it("an unmatched row can be added as a generic plant", () => {
    let s = matched("xyzzy");
    s = useGeneric(s, row(s).id);
    assert.equal(row(s).generic, true);
    assert.equal(groupRows(s).unmatched.length, 0);
  });

  it("a row can be removed", () => {
    let s = matched("aloe vera\nxyzzy");
    s = removeRow(s, row(s, 1).id);
    assert.equal(s.rows.length, 1);
  });
});

describe("navigation keeps what was typed", () => {
  it("back from match returns to the text, unchanged", () => {
    let s = matched("aloe vera\nxyzzy");
    s = goBack(s);
    assert.equal(s.step, "type");
    assert.equal(s.text, "aloe vera\nxyzzy");
  });

  it("the steps run type, match, place, verify", () => {
    let s = matched("aloe vera");
    assert.equal(s.step, "match");
    s = advance(s);
    assert.equal(s.step, "place");
    s = advance(s);
    assert.equal(s.step, "verify");
    s = goBack(s);
    assert.equal(s.step, "place");
  });

  it("editing the text and matching again rebuilds the rows", () => {
    let s = goBack(matched("aloe vera"));
    s = runMatch(setText(s, "monstera"), en);
    assert.equal(s.rows.length, 1);
    assert.equal(row(s).speciesId, "monstera-deliciosa");
  });
});

describe("place: step 3", () => {
  it("defaults to indoors", () => {
    const s = matched("aloe vera");
    assert.equal(placementOf(row(s), SPECIES), "indoor");
  });

  it("a garden-only entry defaults to in the ground", () => {
    const garden = {
      ...(SPECIES[0] as (typeof SPECIES)[number]),
      id: "rose",
      name: "Rose",
      scientificName: "Rosa",
      tags: ["garden_bed"],
    };
    const m = makeMatcher([garden], "en-GB");
    const s = matched("rose", m);
    assert.equal(placementOf(row(s), [garden]), "ground");
  });

  it("an entry that is also an indoor plant stays indoors", () => {
    const both = {
      ...(SPECIES[0] as (typeof SPECIES)[number]),
      id: "mint",
      tags: ["garden_bed", "indoor"],
    };
    assert.equal(
      placementOf({ ...row(matched("aloe vera")), speciesId: "mint" }, [both]),
      "indoor",
    );
  });

  it("a chip sets one plant, 'same as above' copies placement and room from the row above", () => {
    let s = matched("aloe vera\nmonstera\nsnake plant");
    s = setRowPlacement(s, row(s, 0).id, "outdoor_pot");
    s = setRowRoom(s, row(s, 0).id, "r1");
    s = sameAsAbove(s, row(s, 1).id, SPECIES);
    assert.equal(placementOf(row(s, 1), SPECIES), "outdoor_pot");
    assert.equal(row(s, 1).roomId, "r1");
    assert.equal(placementOf(row(s, 2), SPECIES), "indoor");
    assert.equal(row(s, 2).roomId, undefined);
  });

  it("'same as above' on the first row does nothing", () => {
    const s = matched("aloe vera");
    assert.deepEqual(sameAsAbove(s, row(s).id, SPECIES), s);
  });

  it("'decide later' is the default room (no roomId)", () => {
    const s = matched("aloe vera");
    assert.equal(row(s).roomId, undefined);
    assert.equal(
      row(setRowRoom(setRowRoom(s, row(s).id, "r1"), row(s).id, undefined)).roomId,
      undefined,
    );
  });
});

describe("verify: step 4", () => {
  it("resolved rows are ticked, unresolved ones are not", () => {
    let s = matched("aloe vera\npothos\nxyzzy");
    s = advance(advance(s));
    assert.deepEqual(
      s.rows.map((r) => r.included),
      [true, false, false],
    );
  });

  it("a row can be unticked and ticked again", () => {
    let s = advance(advance(matched("aloe vera")));
    s = toggleRow(s, row(s).id);
    assert.equal(row(s).included, false);
    s = toggleRow(s, row(s).id);
    assert.equal(row(s).included, true);
  });

  it("an unresolved row cannot be ticked", () => {
    let s = advance(advance(matched("xyzzy")));
    s = toggleRow(s, row(s).id);
    assert.equal(row(s).included, false);
  });

  it("'not sure' is the default watering answer", () => {
    assert.equal(matched("aloe vera").watered, "unsure");
    assert.equal(setWatered(matched("aloe vera"), "today").watered, "today");
  });
});

describe("saveBulk", () => {
  const verified = (text: string, tweak: (s: BulkState) => BulkState = (s) => s): BulkState =>
    advance(advance(tweak(matched(text))));

  it("creates a plant per ticked row, one per counted plant, numbered when repeated", () => {
    const s = verified("2x aloe vera\nmonstera");
    const out = saveBulk(emptyData(), s, TODAY, SPECIES);
    assert.equal(out.saved, 3);
    assert.deepEqual(
      out.data.plants.map((p) => p.name),
      ["Aloe vera", "Aloe vera 2", "Swiss cheese plant"],
    );
    assert.ok(out.data.plants.every((p) => p.spaceId === out.data.spaces[0]?.id));
    assert.equal(new Set(out.data.plants.map((p) => p.id)).size, 3);
  });

  it("copies the catalogue care and marks every assumed value with its source", () => {
    const out = saveBulk(emptyData(), verified("aloe vera"), TODAY, SPECIES);
    const p = first(out.data.plants);
    assert.ok(p);
    const aloe = SPECIES.find((r) => r.id === "aloe-vera");
    assert.equal(p.species, "Aloe vera");
    assert.equal(p.intervalDays, aloe?.intervalDays);
    assert.equal(p.style, aloe?.style);
    assert.equal(p.fieldSources?.species, "catalogue");
    assert.equal(p.fieldSources.intervalDays, "catalogue");
    assert.equal(p.fieldSources.style, "catalogue");
    assert.equal(p.fieldSources.placement, "default");
    assert.equal(p.fieldSources.drainage, "default");
    assert.equal(p.fieldSources.lastWatered, "default");
    assert.equal(p.fieldSources.light, "default");
    assert.equal(p.fieldSources.potDiameterCm, "default");
    assert.equal(p.fieldSources.potMaterial, "default");
    assert.equal(p.fieldSources.name, "catalogue");
    assert.equal(p.potDiameterCm, 15);
    assert.equal(p.placement, "indoor");
    assert.equal(p.lastWatered, undefined);
    assert.equal(p.unmatched, undefined);
  });

  it("the uncertainty margin comes from the assumed fields (B1 caps it at 3)", () => {
    const out = saveBulk(emptyData(), verified("aloe vera"), TODAY, SPECIES);
    assert.equal(assumedMarginDays(first(out.data.plants)), 3);
  });

  it("a picked candidate is the user's choice; a chip the user touched is the user's", () => {
    const s = verified("pothos", (x) => {
      const picked = pickCandidate(x, row(x).id, "epipremnum-aureum");
      return setRowPlacement(picked, row(picked).id, "outdoor_pot");
    });
    const p = first(saveBulk(emptyData(), s, TODAY, SPECIES).data.plants);
    assert.equal(p.fieldSources?.species, "user");
    assert.equal(p.placement, "outdoor_pot");
    assert.equal(p.fieldSources.placement, "user");
  });

  it("'I watered all of these today' sets the date as the user's answer", () => {
    const p = first(
      saveBulk(emptyData(), setWatered(verified("aloe vera"), "today"), TODAY, SPECIES).data.plants,
    );
    assert.equal(p.lastWatered, TODAY);
    assert.equal(p.fieldSources?.lastWatered, "user");
    assert.equal(assumedMarginDays(p), 3);
  });

  it("a plant in the ground has no pot, drainage or material to assume", () => {
    const s = verified("aloe vera", (x) => setRowPlacement(x, row(x).id, "ground"));
    const p = first(saveBulk(emptyData(), s, TODAY, SPECIES).data.plants);
    assert.equal(p.placement, "ground");
    assert.equal(p.potDiameterCm, undefined);
    assert.equal(p.fieldSources?.potDiameterCm, undefined);
    assert.equal(p.fieldSources?.potMaterial, undefined);
    assert.equal(p.fieldSources?.drainage, undefined);
  });

  it("a room is the plant's room; 'decide later' leaves it out", () => {
    const s = verified("aloe vera\nmonstera", (x) => setRowRoom(x, row(x, 0).id, "r1"));
    const plants = saveBulk(emptyData(), s, TODAY, SPECIES).data.plants;
    assert.deepEqual(
      plants.map((x) => x.roomId),
      ["r1", undefined],
    );
  });

  it("a generic plant runs on the generic profile, flagged unmatched, named as typed", () => {
    const s = verified("xyzzy", (x) => useGeneric(x, row(x).id));
    const p = first(saveBulk(emptyData(), s, TODAY, SPECIES).data.plants);
    assert.equal(p.name, "xyzzy");
    assert.equal(p.unmatched, true);
    assert.equal(p.species, undefined);
    assert.equal(p.style, "let_top_dry");
    assert.equal(p.intervalDays, 10);
    assert.equal(p.fieldSources?.species, "default");
    assert.equal(p.fieldSources.intervalDays, "default");
  });

  it("unticked rows become 'Not added yet' drafts and no plants", () => {
    const s = verified("aloe vera\npothos\nxyzzy");
    const out = saveBulk(emptyData(), s, TODAY, SPECIES);
    assert.equal(out.saved, 1);
    assert.equal(out.notAdded, 2);
    assert.equal(out.data.plants.length, 1);
    const drafts = out.data.drafts ?? [];
    assert.deepEqual(
      drafts.map((d) => d.fields["plantName"]),
      ["pothos", "xyzzy"],
    );
    assert.ok(drafts.every((d) => d.savedOn === TODAY));
    assert.ok(drafts.every((d) => !isBulkDraft(d)));
  });

  it("an unticked but matched row keeps its species in the draft", () => {
    let s = advance(advance(matched("aloe vera")));
    s = toggleRow(s, row(s).id);
    const d = first(saveBulk(emptyData(), s, TODAY, SPECIES).data.drafts);
    assert.equal(d.fields["plantName"], "Aloe vera");
    assert.equal(d.fields["species"], "Aloe vera");
  });

  it("saving removes the typed-text draft", () => {
    const withDraft = saveBulkDraft(emptyData(), "aloe vera", TODAY);
    const out = saveBulk(withDraft, verified("aloe vera"), TODAY, SPECIES);
    assert.equal(bulkDraftText(out.data), undefined);
  });

  it("adding plants has no daily cap and awards nothing (D-15)", () => {
    const text = Array.from({ length: 60 }, () => "aloe vera").join("\n");
    const out = saveBulk(emptyData(), verified(text), TODAY, SPECIES);
    assert.equal(out.saved, 60);
  });
});

describe("draft survival: the text outlives a reload", () => {
  it("saves and reads the typed text", () => {
    const d = saveBulkDraft(emptyData(), "pothos\njade", TODAY);
    assert.equal(bulkDraftText(d), "pothos\njade");
    assert.equal(d.plants.length, 0);
  });

  it("saving again replaces it, one draft only", () => {
    let d = saveBulkDraft(emptyData(), "a", TODAY);
    d = saveBulkDraft(d, "a\nb", TODAY);
    assert.equal(bulkDraftText(d), "a\nb");
    assert.equal(d.drafts?.length, 1);
  });

  it("empty text clears the draft, and clearBulkDraft removes it", () => {
    let d = saveBulkDraft(emptyData(), "a", TODAY);
    assert.equal(bulkDraftText(saveBulkDraft(d, "  ", TODAY)), undefined);
    d = clearBulkDraft(d);
    assert.equal(bulkDraftText(d), undefined);
  });

  it("the draft is a plant draft, so a plant is never scheduled from it", () => {
    const d = saveBulkDraft(emptyData(), "pothos", TODAY);
    assert.equal(makePlan(d, TODAY).plants.length, 0);
    assert.ok((d.drafts ?? []).every(isBulkDraft));
  });

  it("starting the flow from a saved draft restores the text", () => {
    const d = saveBulkDraft(emptyData(), "pothos\njade", TODAY);
    assert.equal(startBulk(bulkDraftText(d)).text, "pothos\njade");
  });
});
