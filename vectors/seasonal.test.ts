// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  leaveOutUntil,
  safeMinC,
  seasonalPrompts,
  snoozeUntil,
  type PlantInput,
  type SeasonalHome,
  type SeasonalSpecies,
  type SeasonalState,
  type WeatherDay,
} from "@green-garden/engine";

const plant = (id: string, over: Partial<PlantInput> = {}): PlantInput => ({
  id,
  style: "let_top_dry",
  intervalDays: 7,
  ...over,
});
const SPECIES: Record<string, SeasonalSpecies> = {
  calamondin: { tags: ["indoor", "outdoor_pot", "tender"], hardiness: "H2" },
  hardy: { tags: ["outdoor_pot"], hardiness: "H5" },
  tagonly: { tags: ["outdoor_pot", "tender"] },
  pothos: { tags: ["indoor"], hardiness: "H1c" },
};
const species = new Map<string, string>([
  ["cal", "calamondin"],
  ["har", "hardy"],
  ["tag", "tagonly"],
  ["pot", "pothos"],
]);
const home: SeasonalHome = { hemisphere: "north", latitude: 55, winterMin: "H4" };
const run = (
  plants: PlantInput[],
  today: string,
  weather: WeatherDay[] = [],
  h: SeasonalHome = home,
  state: SeasonalState = {},
) =>
  seasonalPrompts({
    plants,
    speciesOf: (p) => SPECIES[species.get(p.id) ?? ""],
    home: h,
    weather,
    today,
    state,
  });
const fc = (date: string, tMinC: number): WeatherDay => ({
  date,
  rainMm: 0,
  tMinC,
  forecast: true,
});

describe("safe minimum (RHS bands, from knowledge, verify)", () => {
  it("is the lower edge of the band", () => {
    assert.equal(safeMinC("H1c"), 5);
    assert.equal(safeMinC("H2"), 1);
    assert.equal(safeMinC("H3"), -5);
    assert.equal(safeMinC("H4"), -10);
    assert.equal(safeMinC("nonsense"), undefined);
  });
});

describe("bring-in card", () => {
  const cal = plant("cal", { placement: "outdoor_pot" });
  it("with weather: frost in the next 3 days at or below safe min + 3 C", () => {
    const w = [fc("2026-10-02", 6), fc("2026-10-03", 4)];
    const out = run([cal], "2026-10-01", w);
    assert.deepEqual(
      out.map((p) => [p.plantId, p.kind, p.basis]),
      [["cal", "bring_in", "forecast"]],
    );
  });
  it("with weather: a mild forecast gives no card, even late in the year", () => {
    assert.deepEqual(run([cal], "2026-11-20", [fc("2026-11-21", 9)]), []);
  });
  it("a cold day beyond the 3-day window does not count", () => {
    assert.deepEqual(run([cal], "2026-10-01", [fc("2026-10-02", 9), fc("2026-10-06", 0)]), []);
  });
  it("without weather: calendar, once the rest ramp is at a third (55 N: 12 October)", () => {
    assert.deepEqual(run([cal], "2026-10-11"), []);
    assert.deepEqual(
      run([cal], "2026-10-12").map((p) => p.basis),
      ["calendar"],
    );
  });
  it("hardy for the home (H5 in an H4 home): no card", () => {
    assert.deepEqual(run([plant("har", { placement: "outdoor_pot" })], "2026-12-01"), []);
  });
  it("hardiness missing: the tender tag qualifies", () => {
    assert.equal(run([plant("tag", { placement: "outdoor_pot" })], "2026-12-01").length, 1);
  });
  it("no winterMin: only the tender tag test runs", () => {
    const h: SeasonalHome = { hemisphere: "north", latitude: 55 };
    assert.equal(run([plant("har", { placement: "outdoor_pot" })], "2026-12-01", [], h).length, 0);
    assert.equal(run([cal], "2026-12-01", [], h).length, 1);
  });
  it("indoor and in-ground plants never get it", () => {
    assert.deepEqual(run([plant("cal"), plant("cal", { placement: "ground" })], "2026-12-01"), []);
  });
  it("Not yet snoozes 7 days", () => {
    const until = snoozeUntil("2026-10-12");
    assert.equal(until, "2026-10-19");
    const st = { snoozedUntil: { cal: until } };
    assert.deepEqual(run([cal], "2026-10-18", [], home, st), []);
    assert.equal(run([cal], "2026-10-19", [], home, st).length, 1);
  });
  it("Leave it out holds until next 1 July (north) or 1 January (south)", () => {
    assert.equal(leaveOutUntil("2026-10-12", "north"), "2027-07-01");
    assert.equal(leaveOutUntil("2026-03-12", "north"), "2026-07-01");
    assert.equal(leaveOutUntil("2026-10-12", "south"), "2027-01-01");
    const left = { leftOutUntil: { cal: leaveOutUntil("2026-10-12", "north") } };
    assert.deepEqual(run([cal], "2026-12-01", [], home, left), []);
    assert.equal(run([cal], "2027-07-01", [fc("2027-07-02", 0)], home, left).length, 1);
  });
});

describe("put-out card", () => {
  const cal = plant("cal");
  it("without weather: 45 quiet days (restWeight is 0 from 31 March; 14 May at 55 N)", () => {
    assert.deepEqual(run([cal], "2027-05-13"), []);
    assert.deepEqual(
      run([cal], "2027-05-14").map((p) => [p.kind, p.basis]),
      [["put_out", "calendar"]],
    );
  });
  it("with weather: no forecast minimum under safe + 3 C in the next 7 days, 30 quiet days", () => {
    const warm = [fc("2027-05-02", 8), fc("2027-05-06", 9)];
    assert.deepEqual(
      run([cal], "2027-05-01", warm).map((p) => p.basis),
      ["forecast"],
    );
    assert.deepEqual(run([cal], "2027-05-01", [...warm, fc("2027-05-05", 3)]), []);
    assert.deepEqual(run([cal], "2027-04-20", [fc("2027-04-21", 9)]), []);
  });
  it("a plain houseplant with neither history nor tags gets none", () => {
    assert.deepEqual(run([plant("pot")], "2027-06-20"), []);
  });
  it("a plant that was outdoors in an earlier year qualifies even without the tags", () => {
    const p = plant("pot", {
      placementHistory: [
        { on: "2025-06-01", placement: "outdoor_pot" },
        { on: "2025-11-01", placement: "indoor" },
      ],
    });
    assert.equal(run([p], "2027-06-20").length, 1);
    const sameYear = plant("pot", {
      placementHistory: [
        { on: "2027-01-01", placement: "outdoor_pot" },
        { on: "2027-02-01", placement: "indoor" },
      ],
    });
    assert.equal(run([sameYear], "2027-06-20").length, 0);
  });
  it("is quiet when snoozed", () => {
    assert.deepEqual(
      run([cal], "2027-05-20", [], home, { snoozedUntil: { cal: "2027-05-22" } }),
      [],
    );
  });
});
