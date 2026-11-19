// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, emptyData, type AppData, type Plant } from "@green-garden/storage";
import {
  answerFollowUp,
  careFill,
  draftFromSettings,
  followUpsOf,
  homeQuestionNeeded,
  isOutdoorPlacement,
  pickClimate,
  pickRegion,
  pickWinterMin,
  saveHome,
  suggestionOf,
} from "../src/index.ts";

const plant = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: id,
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  ...extra,
});
const withPlants = (plants: Plant[], climate?: AppData["settings"]["climate"]): AppData => {
  const d = emptyData();
  return {
    ...d,
    plants,
    settings: { ...d.settings, ...(climate === undefined ? {} : { climate }) },
  };
};

describe("Q-K0 gate", () => {
  it("knows which placements are outdoors", () => {
    assert.equal(isOutdoorPlacement("ground"), true);
    assert.equal(isOutdoorPlacement("outdoor_pot"), true);
    assert.equal(isOutdoorPlacement("indoor"), false);
    assert.equal(isOutdoorPlacement(undefined), false);
  });

  it("asks when the first outdoor plant arrives and no climate is set", () => {
    const before = withPlants([plant("a")]);
    const after = withPlants([plant("a"), plant("b", { placement: "ground" })]);
    assert.equal(homeQuestionNeeded(before, after), true);
  });

  it("asks for a pot outside too, and for an indoor plant moved outside", () => {
    const before = withPlants([plant("a", { placement: "indoor" })]);
    assert.equal(
      homeQuestionNeeded(before, withPlants([plant("a", { placement: "outdoor_pot" })])),
      true,
    );
  });

  it("does not ask when the climate is already set", () => {
    const before = withPlants([], "mediterranean");
    const after = withPlants([plant("b", { placement: "ground" })], "mediterranean");
    assert.equal(homeQuestionNeeded(before, after), false);
  });

  it("does not ask for indoor plants, or for outdoor plants that were already saved", () => {
    assert.equal(homeQuestionNeeded(withPlants([]), withPlants([plant("a")])), false);
    const old = withPlants([plant("g", { placement: "ground" })]);
    assert.equal(homeQuestionNeeded(old, withPlants([plant("g", { placement: "ground" })])), false);
  });
});

describe("Q-K0 draft", () => {
  it("a region without follow-ups suggests its own home", () => {
    const d = pickRegion(draftFromSettings({}), "gb-england-east");
    assert.deepEqual(suggestionOf(d), { climate: "oceanic_dry", winterMin: "H4" });
    assert.equal(d.climate, "oceanic_dry");
    assert.equal(d.winterMin, "H4");
    assert.deepEqual(followUpsOf(d), []);
  });

  it("a follow-up answer changes the suggestion and fills both selects", () => {
    const d0 = pickRegion(draftFromSettings({}), "gb-scotland-west");
    assert.equal(followUpsOf(d0).length, 1);
    const d1 = answerFollowUp(d0, 0, "high");
    assert.deepEqual(suggestionOf(d1), { climate: "mountain", winterMin: "H5" });
    assert.equal(d1.climate, "mountain");
  });

  it("both selects stay changeable after a suggestion", () => {
    const d = pickWinterMin(
      pickClimate(pickRegion(draftFromSettings({}), "gb-england-east"), "med_mild"),
      "H3",
    );
    assert.equal(d.climate, "med_mild");
    assert.equal(d.winterMin, "H3");
  });

  it("changing the region drops the old answers and suggestion", () => {
    const d = answerFollowUp(pickRegion(draftFromSettings({}), "gb-scotland-west"), 0, "high");
    const e = pickRegion(d, "gb-england-east");
    assert.deepEqual(e.answers, []);
    assert.equal(e.climate, "oceanic_dry");
  });

  it("a required follow-up not yet answered gives no suggestion and cannot be saved", () => {
    const d = pickRegion(draftFromSettings({}), "es-canary-high-islands");
    assert.equal(suggestionOf(d), undefined);
    assert.equal(saveHome(emptyData(), d), undefined);
  });

  it("starts from what the settings already hold", () => {
    const d = draftFromSettings({ climate: "arid", winterMin: "H2" });
    assert.equal(d.climate, "arid");
    assert.equal(d.winterMin, "H2");
    assert.equal(d.regionId, undefined);
  });

  it("saving writes climate and winterMin, and the country when none is set", () => {
    const d = pickRegion(draftFromSettings({}), "gb-england-east");
    const saved = saveHome(emptyData(), d);
    assert.ok(saved);
    assert.equal(saved.settings.climate, "oceanic_dry");
    assert.equal(saved.settings.winterMin, "H4");
    assert.equal(saved.settings.country, "GB");
    const keep = emptyData();
    const es = saveHome({ ...keep, settings: { ...keep.settings, country: "ES" } }, d);
    assert.equal(es?.settings.country, "ES");
  });

  it("saving needs both values", () => {
    assert.equal(saveHome(emptyData(), draftFromSettings({ climate: "arid" })), undefined);
  });
});

describe("catalogue outdoor fields reach the plant", () => {
  it("careFill carries the outdoor fields a row has", () => {
    const fill = careFill({
      id: "x",
      name: "Box",
      scientificName: "Buxus",
      style: "let_top_dry",
      intervalDays: 7,
      restFactor: 1,
      dryTolDays: 3,
      wetTolDays: 3,
      confidence: "c",
      careSource: "s",
      commonNames: [],
      synonyms: [],
      tags: [],
      outdoor: {
        rootDepth: "shallow",
        droughtTolerance: "moderate",
        dormancy: "none",
        establishmentSeasons: 2,
        establishingIntervalDays: 5,
      },
    });
    assert.deepEqual(fill.outdoor, {
      rootDepth: "shallow",
      droughtTolerance: "moderate",
      dormancy: "none",
      establishmentSeasons: 2,
      establishingIntervalDays: 5,
    });
  });

  it("a row without them leaves the fill without them", () => {
    const fill = careFill({
      id: "x",
      name: "Pothos",
      scientificName: "E",
      style: null,
      intervalDays: null,
      restFactor: null,
      dryTolDays: null,
      wetTolDays: null,
      confidence: "c",
      careSource: "s",
      commonNames: [],
      synonyms: [],
      tags: [],
    });
    assert.equal("outdoor" in fill, false);
  });
});

describe("bulk add copies the outdoor fields", () => {
  it("a saved plant carries its catalogue entry's outdoor fields", async () => {
    const { advance, makeMatcher, runMatch, saveBulk, startBulk } = await import("../src/index.ts");
    const row = {
      id: "box",
      name: "Box",
      scientificName: "Buxus sempervirens",
      style: "let_top_dry" as const,
      intervalDays: 7,
      restFactor: 1,
      dryTolDays: 3,
      wetTolDays: 3,
      confidence: "c",
      careSource: "s",
      commonNames: ["Box"],
      synonyms: [],
      tags: [],
      outdoor: { rootDepth: "shallow" as const, droughtTolerance: "moderate" as const },
    };
    const m = makeMatcher([row], "en-GB");
    const state = advance(advance(runMatch(startBulk("box"), m)));
    const res = saveBulk(emptyData(), state, "2026-11-03", [row]);
    const [first] = res.data.plants;
    assert.ok(first);
    assert.equal(first.rootDepth, "shallow");
    assert.equal(first.droughtTolerance, "moderate");
    assert.equal(first.dormancy, undefined);
  });
});
