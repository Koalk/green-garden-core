// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { DEFAULT_SPACE_ID, emptyData, type AppData, type Plant } from "@green-garden/storage";
import { logRain } from "../src/actions.ts";
import {
  RAIN_SIZES,
  assumedChipHtml,
  bedAmountWords,
  canLogRain,
  forecastHint,
  outdoorBlockHtml,
  outdoorStatus,
  rainButtonsHtml,
  todayOutdoorHtml,
  withCatalogueOutdoor,
} from "../src/outdoor.ts";
import { makePlan } from "../src/view.ts";

const SUMMER = "2026-07-15";
const WINTER = "2026-11-03";

const plant = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: id,
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  ...extra,
});

function garden(plants: Plant[]): AppData {
  const d = emptyData();
  return { ...d, plants, settings: { ...d.settings, climate: "oceanic_wet", winterMin: "H4" } };
}

const lavender = plant("lav", {
  name: "Lavender",
  placement: "ground",
  droughtTolerance: "high",
  rootDepth: "deep",
  logs: [{ date: "2026-06-01", outcome: "done" }],
});
const evergreen = plant("holly", {
  name: "Holly",
  placement: "ground",
  droughtTolerance: "none",
  dormancy: "none",
  logs: [{ date: "2026-09-01", outcome: "done" }],
});
const sheltered = plant("pot", {
  name: "Porch pot",
  placement: "outdoor_pot",
  sheltered: true,
  logs: [{ date: "2026-10-28", outcome: "done" }],
});
const indoor = plant("fern", { name: "Fern", logs: [{ date: "2026-10-28", outcome: "done" }] });

afterEach(() => {
  setLocale("en-GB");
});

describe("outdoor status from the plan", () => {
  it("a rain-fed plant gets the calm line, no task, and the drought check after a long dry spell", () => {
    const plan = makePlan(garden([lavender]), SUMMER);
    const s = outdoorStatus(plan, "lav");
    assert.ok(s);
    assert.equal(s.kind, "rain_fed");
    assert.equal(s.line, "Rain-fed, no watering needed");
    assert.equal(s.drought, true);
    assert.equal(
      plan.days.some((d) => d.plantIds.includes("lav")),
      false,
    );
  });

  it("no drought check before the first record", () => {
    const fresh = { ...lavender, logs: [] };
    const s = outdoorStatus(makePlan(garden([fresh]), SUMMER), "lav");
    assert.equal(s?.drought, false);
  });

  it("a resting plant says until when, and offers the winter soak only when the plan does", () => {
    const plan = makePlan(garden([evergreen, lavender]), WINTER);
    const s = outdoorStatus(plan, "holly");
    assert.ok(s);
    assert.equal(s.kind, "dormant");
    assert.match(s.line, /^Resting until 20\d\d-\d\d-\d\d$/);
    assert.equal(s.soak, true);
    const other = outdoorStatus(makePlan(garden([{ ...evergreen, logs: [] }]), WINTER), "holly");
    assert.equal(other?.soak, false);
  });

  it("plants on a schedule and indoor plants have no outdoor status", () => {
    const plan = makePlan(garden([sheltered, indoor]), SUMMER);
    assert.equal(outdoorStatus(plan, "pot"), undefined);
    assert.equal(outdoorStatus(plan, "fern"), undefined);
  });
});

describe("the outdoor card block", () => {
  it("rain-fed: the calm line, 'Looks fine' logs looks_fine, 'I watered it' logs done", () => {
    const data = garden([lavender]);
    const html = outdoorBlockHtml(makePlan(data, SUMMER), data, lavender, SUMMER);
    assert.match(html, /Rain-fed, no watering needed/);
    assert.match(html, /Look at it: is it drooping in the morning\?/);
    assert.match(html, /data-outcome="looks_fine"[^>]*>Looks fine</);
    assert.match(html, /data-outcome="done"[^>]*>I watered it</);
  });

  it("rain-fed without a due check shows the line and no check buttons", () => {
    const fresh = { ...lavender, logs: [] };
    const data = garden([fresh]);
    const html = outdoorBlockHtml(makePlan(data, SUMMER), data, fresh, SUMMER);
    assert.match(html, /Rain-fed, no watering needed/);
    assert.doesNotMatch(html, /looks_fine/);
  });

  it("dormant: 'Resting until', with the optional winter soak and the same two buttons", () => {
    const data = garden([evergreen]);
    const html = outdoorBlockHtml(makePlan(data, WINTER), data, evergreen, WINTER);
    assert.match(html, /Resting until/);
    assert.match(html, /winter soak would help/);
    assert.match(html, /data-outcome="looks_fine"/);
    assert.match(html, /data-outcome="done"[^>]*>I watered it</);
  });

  it("'It rained' has light 5 mm, proper 12 mm and downpour 25 mm", () => {
    assert.deepEqual(
      RAIN_SIZES.map((s) => s.mm),
      [5, 12, 25],
    );
    const html = rainButtonsHtml("lav", "Lavender");
    for (const mm of [5, 12, 25]) assert.match(html, new RegExp(`data-mm="${mm}"`));
    assert.match(html, /data-action="rain"/);
    assert.match(html, /It rained/);
    assert.match(html, /Light rain, 5 mm/);
    assert.match(html, /Downpour, 25 mm/);
  });

  it("the rain buttons are in the block for an exposed plant, not for a sheltered or indoor one", () => {
    const data = garden([lavender, sheltered, indoor]);
    const plan = makePlan(data, SUMMER);
    assert.match(outdoorBlockHtml(plan, data, lavender, SUMMER), /data-action="rain"/);
    assert.doesNotMatch(outdoorBlockHtml(plan, data, sheltered, SUMMER), /data-action="rain"/);
    assert.equal(outdoorBlockHtml(plan, data, indoor, SUMMER), "");
    assert.equal(canLogRain(lavender), true);
    assert.equal(canLogRain(sheltered), false);
    assert.equal(canLogRain(indoor), false);
  });

  it("the forecast hint shows only when the plan names the plant, and never edits the plan", () => {
    const data = garden([sheltered]);
    const plan = makePlan(data, SUMMER);
    assert.equal(forecastHint(plan, "pot"), undefined);
    const hinted = { ...plan, rainForecastFor: ["pot"] };
    assert.equal(forecastHint(hinted, "pot"), "Rain forecast: you may wait");
    assert.deepEqual(hinted.days, plan.days);
  });

  it("assumed values get a chip that names them", () => {
    assert.equal(assumedChipHtml([]), "");
    const chip = assumedChipHtml(["droughtTolerance", "phase"]);
    assert.match(chip, /class="assumed"/);
    assert.match(chip, />assumed</);
    assert.match(chip, /how tolerant it is of drought/);
  });

  it("an outdoor plant with assumed care shows the chip in its block", () => {
    const data = garden([lavender]);
    const html = outdoorBlockHtml(makePlan(data, SUMMER), data, lavender, SUMMER);
    assert.match(html, /class="assumed"/);
  });
});

describe("amounts for a bed, in cans and minutes, never ml", () => {
  it("words a ground plant by its root depth", () => {
    const deep = bedAmountWords(plant("a", { placement: "ground", rootDepth: "deep" }));
    assert.ok(deep);
    assert.match(deep, /3 watering cans/);
    assert.match(deep, /slow 15 minutes with the hose/);
    const shallow = bedAmountWords(plant("b", { placement: "ground", rootDepth: "shallow" }));
    assert.match(shallow ?? "", /1 watering can[^s]/);
    assert.match(
      bedAmountWords(plant("c", { placement: "ground" })) ?? "",
      /2 watering cans.*slow 10 minutes/,
    );
    for (const w of [deep, shallow]) assert.doesNotMatch(w ?? "", /\bml\b|litre/i);
  });

  it("pots and indoor plants keep the usual amount lines", () => {
    assert.equal(bedAmountWords(plant("a", { placement: "outdoor_pot" })), undefined);
    assert.equal(bedAmountWords(plant("b")), undefined);
  });
});

describe("Today for outdoor plants", () => {
  it("lists what needs a look and has one 'It rained' row for the exposed plants", () => {
    const data = garden([lavender, sheltered]);
    const html = todayOutdoorHtml(makePlan(data, SUMMER), data);
    assert.match(html, /Lavender/);
    assert.match(html, /data-outcome="looks_fine"/);
    assert.match(html, /data-action="rain-all"/);
    assert.doesNotMatch(html, /Porch pot/);
  });

  it("is empty for a garden with nothing outdoors, so indoor Today does not change", () => {
    const data = garden([indoor]);
    assert.equal(todayOutdoorHtml(makePlan(data, SUMMER), data), "");
  });

  it("with only a sheltered plant outdoors there is nothing to log rain for", () => {
    const data = garden([sheltered]);
    assert.equal(todayOutdoorHtml(makePlan(data, SUMMER), data), "");
  });
});

describe("logging rain", () => {
  it("logs rain with the mm for each exposed outdoor plant and skips the rest", () => {
    const data = garden([lavender, sheltered, indoor]);
    const next = logRain(data, ["lav", "pot", "fern"], 12, SUMMER);
    const last = (id: string): Plant["logs"] =>
      next.plants.find((p) => p.id === id)?.logs?.slice(-1);
    assert.deepEqual(last("lav"), [{ date: SUMMER, outcome: "rain", mm: 12 }]);
    assert.equal(last("pot")?.[0]?.outcome, "done");
    assert.equal(last("fern")?.[0]?.outcome, "done");
  });
});

describe("catalogue outdoor fields at add time (part 3)", () => {
  it("copies what the entry has and keeps what the plant already says", () => {
    const row = {
      outdoor: { rootDepth: "shallow", droughtTolerance: "moderate", establishmentSeasons: 2 },
    } as const;
    const added = withCatalogueOutdoor(plant("x"), row);
    assert.equal(added.rootDepth, "shallow");
    assert.equal(added.droughtTolerance, "moderate");
    assert.equal(added.establishmentSeasons, 2);
    const kept = withCatalogueOutdoor(plant("x", { rootDepth: "deep" }), row);
    assert.equal(kept.rootDepth, "deep");
  });

  it("an entry without outdoor fields, or no entry, changes nothing", () => {
    const p = plant("x");
    assert.equal(withCatalogueOutdoor(p, {}), p);
    assert.equal(withCatalogueOutdoor(p, undefined), p);
  });
});
