// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWindows, type PlanInput, type PlantInput } from "@green-garden/engine";
import {
  DEFAULT_SPACE_ID,
  buildPlanInput,
  emptyData,
  startFactsFor,
  type AppData,
  type Plant,
} from "../src/index.ts";

const monstera: Plant = {
  id: "p1",
  spaceId: DEFAULT_SPACE_ID,
  name: "Monstera",
  style: "let_top_dry",
  intervalDays: 10,
  lastWatered: "2026-11-02",
  logs: [],
};

function dataWith(plant: Plant, light?: "low" | "direct"): AppData {
  return {
    ...emptyData(),
    plants: [plant],
    rooms: [
      {
        id: "r1",
        name: "Kitchen",
        spaceId: DEFAULT_SPACE_ID,
        ...(light === undefined ? {} : { light }),
      },
    ],
  };
}

function first(input: PlanInput): PlantInput {
  const p = input.plants?.[0];
  assert.ok(p);
  return p;
}

const eligible: Plant = {
  ...monstera,
  roomId: "r1",
  potDiameterCm: 18,
  potMaterial: "terracotta",
  fieldSources: { intervalDays: "catalogue" },
};

describe("start multipliers reach the engine", () => {
  it("a catalogue interval gets the pot, the material and the room's light", () => {
    const input = buildPlanInput(dataWith(eligible, "low"), "2026-11-02");
    const p = first(input);
    assert.equal(p.potDiameterCm, 18);
    assert.equal(p.potMaterial, "terracotta");
    assert.equal(p.light, "low");
    // 10 x (1.2 x 1.6 x 0.7 = 1.344) = 13.44 -> 13 days: the window opens 13 - 3 days after the 2nd
    const w = computeWindows(input).windows[0];
    assert.equal(w?.earliest, "2026-11-12");
  });

  it("a plant whose interval the user typed keeps it, whatever the pot", () => {
    const own: Plant = { ...eligible, fieldSources: { intervalDays: "user" } };
    const p = first(buildPlanInput(dataWith(own, "low"), "2026-11-02"));
    assert.equal(p.potDiameterCm, undefined);
    assert.equal(p.potMaterial, undefined);
    assert.equal(p.light, undefined);
    assert.equal(
      computeWindows(buildPlanInput(dataWith(own, "low"), "2026-11-02")).windows[0]?.earliest,
      "2026-11-09",
    );
  });

  it("a plant without any source information counts as typed by the user", () => {
    const bare: Plant = { ...eligible };
    delete (bare as { fieldSources?: unknown }).fieldSources;
    const p = first(buildPlanInput(dataWith(bare, "low"), "2026-11-02"));
    assert.equal(p.potDiameterCm, undefined);
    assert.equal(p.light, undefined);
  });

  it("an old plant filled from the catalogue (source text) is eligible", () => {
    const old: Plant = { ...eligible, source: "catalogue: Monstera (RHS), not verified: low" };
    delete (old as { fieldSources?: unknown }).fieldSources;
    const p = first(buildPlanInput(dataWith(old, "direct"), "2026-11-02"));
    assert.equal(p.light, "direct");
    assert.equal(p.potDiameterCm, 18);
  });

  it("without a room the light is unknown, and the pot facts alone still count", () => {
    const noRoom: Plant = { ...eligible };
    delete (noRoom as { roomId?: unknown }).roomId;
    const p = first(buildPlanInput(dataWith(noRoom), "2026-11-02"));
    assert.equal(p.light, undefined);
    assert.equal(p.potDiameterCm, 18);
  });

  it("startFactsFor is what the amount lines use: the same facts, or none", () => {
    const d = dataWith(eligible, "low");
    assert.deepEqual(startFactsFor(d, eligible), {
      potDiameterCm: 18,
      potMaterial: "terracotta",
      light: "low",
    });
    const own: Plant = { ...eligible, fieldSources: { intervalDays: "user" } };
    assert.equal(startFactsFor(dataWith(own, "low"), own), undefined);
  });
});
