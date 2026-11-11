// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData, type AppData, type Plant } from "@green-garden/storage";
import { plantFromFields } from "../src/drafts.ts";
import { modalHtml } from "../src/modal.ts";
import { applyMove, moveRange, moveSheetHtml, moveTarget, undoMove } from "../src/moves.ts";
import { applyCardChoice, cardsHtml, emptyCardState } from "../src/seasonal-cards.ts";
import {
  formatRanges,
  parseRanges,
  presetRanges,
  sunRowHtml,
  SUN_PRESETS,
} from "../src/sun-hours.ts";

afterEach(() => {
  setLocale("en-GB");
});

const TODAY = "2026-11-09";
const plant = (extra: Partial<Plant> = {}): Plant => ({
  id: "p1",
  spaceId: "space1",
  name: "Calamondin",
  species: "Citrus x microcarpa",
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  placement: "outdoor_pot",
  lastWatered: "2026-11-01",
  ...extra,
});
const noPlacement = (p: Plant): Plant =>
  Object.fromEntries(Object.entries(p).filter(([k]) => k !== "placement")) as unknown as Plant;
const dataWith = (p: Plant): AppData => ({ ...emptyData(), plants: [p] });

describe("move sheet (02m 1.5)", () => {
  it("offers the opposite place, and nothing for a ground plant", () => {
    assert.equal(moveTarget(plant()), "indoor");
    const indoor = noPlacement(plant());
    assert.equal(moveTarget(indoor), "outdoor_pot");
    assert.equal(moveTarget(plant({ placement: "ground" })), undefined);
  });

  it("the date is bounded by the previous entry and today", () => {
    const hist = [{ on: "2026-10-01", placement: "indoor" as const }];
    assert.deepEqual(moveRange(plant({ placementHistory: hist }), TODAY), {
      min: "2026-10-01",
      max: TODAY,
    });
  });

  it("Put outside under cover writes the history, the placement and the flag", () => {
    const indoor = noPlacement(plant());
    const next = applyMove(dataWith(indoor), "p1", { on: "2026-11-05", sheltered: true }, TODAY);
    assert.ok(next);
    const p = next.plants[0] as Plant;
    assert.equal(p.placement, "outdoor_pot");
    assert.equal(p.sheltered, true);
    assert.equal(p.placementHistory?.at(-1)?.on, "2026-11-05");
  });

  it("Bring inside keeps or sets the room", () => {
    const next = applyMove(dataWith(plant()), "p1", { on: TODAY, roomId: "r1" }, TODAY);
    assert.equal(next?.plants[0]?.placement, undefined);
    assert.equal(next?.plants[0]?.roomId, "r1");
  });

  it("refuses a future date and a ground plant", () => {
    assert.equal(applyMove(dataWith(plant()), "p1", { on: "2026-11-10" }, TODAY), undefined);
    assert.equal(
      applyMove(dataWith(plant({ placement: "ground" })), "p1", { on: TODAY }, TODAY),
      undefined,
    );
  });

  it("undo puts the earlier plant back", () => {
    const d = dataWith(plant());
    const next = applyMove(d, "p1", { on: TODAY }, TODAY);
    assert.ok(next);
    assert.deepEqual(undoMove(next, plant()), d);
  });

  it("the sheet shows date, cover row only when going outside, and one Move it button", () => {
    const indoor = noPlacement(plant());
    const out = moveSheetHtml(indoor, TODAY, []);
    assert.match(out, /type="date"[^>]*value="2026-11-09"[^>]*max="2026-11-09"/);
    assert.match(out, /name="sheltered"/);
    assert.equal((out.match(/Move it/g) ?? []).length, 1);
    assert.match(out, /learned timing starts again/i);
    const inn = moveSheetHtml(plant(), TODAY, [{ id: "r1", name: "Hall" }]);
    assert.doesNotMatch(inn, /name="sheltered"/);
    assert.match(inn, /name="roomId"/);
    assert.doesNotMatch(moveSheetHtml(plant({ roomId: "r1" }), TODAY, []), /name="roomId"/);
  });
});

describe("saving an edit keeps what the form does not show", () => {
  it("keeps placementHistory and fieldSources", () => {
    const old = plant({
      placementHistory: [{ on: "2026-10-01", placement: "indoor" }],
      fieldSources: { name: "user" },
    });
    const next = plantFromFields({ plantName: "C", style: "let_top_dry", intervalDays: "7" }, old);
    assert.deepEqual(next.placementHistory, old.placementHistory);
    assert.deepEqual(next.fieldSources, { name: "user" });
  });

  it("reads the cover and sun fields, marking them as the user's", () => {
    const f = {
      plantName: "C",
      style: "let_top_dry",
      intervalDays: "7",
      placement: "outdoor_pot",
      sheltered: "1",
      directSun: "7-11,15-18",
    };
    const p = plantFromFields(f, undefined);
    assert.equal(p.sheltered, true);
    assert.deepEqual(p.directSun, [
      { from: 7, to: 11 },
      { from: 15, to: 18 },
    ]);
    assert.equal(p.fieldSources?.directSun, "user");
    assert.equal(p.fieldSources.sheltered, "user");
    assert.deepEqual(plantFromFields({ ...f, directSun: "none" }, undefined).directSun, []);
    assert.equal(
      plantFromFields({ ...f, directSun: "", sheltered: "" }, undefined).directSun,
      undefined,
    );
    assert.equal(plantFromFields({ ...f, sheltered: "0" }, undefined).sheltered, false);
  });
});

describe("direct sun hours (02m 3.4 and 3.5)", () => {
  it("parses and formats", () => {
    assert.deepEqual(parseRanges("7-11"), [{ from: 7, to: 11 }]);
    assert.deepEqual(parseRanges("none"), []);
    assert.equal(parseRanges(""), undefined);
    assert.equal(parseRanges("11-7"), undefined);
    assert.equal(parseRanges("7-25"), undefined);
    assert.equal(parseRanges("1-2,3-4,5-6,7-8"), undefined);
    assert.equal(parseRanges("7-12,10-14"), undefined);
    assert.equal(formatRanges([{ from: 7, to: 11 }]), "7:00-11:00");
  });

  it("presets match the spec", () => {
    assert.deepEqual(presetRanges("morning"), [{ from: 6, to: 11 }]);
    assert.deepEqual(presetRanges("not_midday"), [
      { from: 7, to: 11 },
      { from: 15, to: 18 },
    ]);
    assert.deepEqual(presetRanges("none"), []);
    assert.equal(presetRanges("unsure"), undefined);
    assert.equal(SUN_PRESETS.length, 7);
  });

  it("the row shows chips, Add hours and Not sure", () => {
    const html = sunRowHtml("7-11");
    assert.match(html, /name="directSun" value="7-11"/);
    assert.match(html, />7:00-11:00</);
    assert.match(html, /\+ Add hours/);
    assert.match(html, /Not sure/);
  });

  it("add and edit carry the cover chips (outdoor only) and the sun row", () => {
    const html = modalHtml({ fields: { placement: "outdoor_pot" }, rooms: [], title: "Add" });
    assert.match(html, /data-action="cover-chip" data-value="open"/);
    assert.match(html, /data-action="cover-chip" data-value="covered"[^>]*>Under cover</);
    assert.match(html, /name="directSun"/);
    const ind = modalHtml({ fields: {}, rooms: [], title: "Add" });
    assert.match(ind, /class="cover[^"]*" hidden/);
  });

  it("es and it have their own words", () => {
    setLocale("es");
    assert.doesNotMatch(sunRowHtml(""), /Not sure/);
    setLocale("it");
    assert.doesNotMatch(sunRowHtml(""), /Add hours/);
  });
});

describe("seasonal cards on Today (02m 1.4)", () => {
  const prompts = [{ plantId: "p1", kind: "bring_in" as const, basis: "forecast" as const }];
  it("a bring-in card has the three buttons and names the plant", () => {
    const html = cardsHtml(prompts, [plant()]);
    assert.match(html, /Frost is coming; bring the Calamondin in\?/);
    assert.match(html, /data-action="season-move"[^>]*>Bring inside</);
    assert.match(html, /data-action="season-snooze"[^>]*>Not yet</);
    assert.match(html, /data-action="season-leave"[^>]*>Leave it out</);
  });

  it("a put-out card is worded for spring", () => {
    const html = cardsHtml([{ plantId: "p1", kind: "put_out", basis: "calendar" }], [plant()]);
    assert.match(html, /Warm enough to put the Calamondin outside again\?/);
    assert.match(html, />Put outside</);
  });

  it("no prompts, no markup", () => {
    assert.equal(cardsHtml([], [plant()]), "");
  });

  it("Not yet and Leave it out write the state", () => {
    const s = applyCardChoice(emptyCardState(), "p1", "snooze", TODAY, "north");
    assert.equal(s.snoozedUntil?.["p1"], "2026-11-16");
    const l = applyCardChoice(s, "p1", "leave", TODAY, "north");
    assert.equal(l.leftOutUntil?.["p1"], "2027-07-01");
  });
});
