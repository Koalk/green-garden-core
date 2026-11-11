// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWindows,
  startMultipliers,
  wateringHint,
  type PlantInput,
} from "@green-garden/engine";

const lights = ["low", "medium", "bright_indirect", "direct"] as const;
const materials = ["plastic", "terracotta", "glazed", "fabric", "other"] as const;

describe("start multipliers (02i recommendation 2; every value is a guess)", () => {
  it("each factor reads as 02i says: bigger pots and dimmer light stretch the interval", () => {
    assert.equal(startMultipliers({ potDiameterCm: 30 }).potSize, 2);
    assert.equal(startMultipliers({ potDiameterCm: 7.5 }).potSize, 0.5);
    assert.equal(startMultipliers({ light: "low" }).light, 1.6);
    assert.equal(startMultipliers({ light: "bright_indirect" }).light, 0.65);
    assert.equal(startMultipliers({ light: "direct" }).light, 0.4);
    assert.equal(startMultipliers({ potMaterial: "terracotta" }).material, 0.7);
    assert.equal(startMultipliers({ potMaterial: "fabric" }).material, 0.7);
    assert.equal(startMultipliers({ potMaterial: "glazed" }).material, 1);
  });

  it("the product is clamped to 0.6 to 1.6 for every combination, and the result says it is a guess", () => {
    for (const light of lights)
      for (const potMaterial of materials)
        for (const potDiameterCm of [4, 8, 12, 15, 20, 30, 60]) {
          const m = startMultipliers({ light, potMaterial, potDiameterCm });
          assert.ok(m.factor >= 0.6 && m.factor <= 1.6, JSON.stringify(m));
          assert.equal(m.guess, true);
          assert.equal(m.clamped === null, m.raw >= 0.6 && m.raw <= 1.6);
        }
  });

  it("the clipped part moves into the amount: smaller factor wanted, bigger amount (the stated rule)", () => {
    const input = { style: "let_top_dry", potDiameterCm: 15 } as const;
    const m = startMultipliers({ potDiameterCm: 15, light: "direct" });
    assert.equal(m.clamped, "low");
    const plain = wateringHint(input).volumeMl ?? 0;
    const more = wateringHint({ ...input, amountFactor: m.amountFactor }).volumeMl ?? 0;
    assert.ok(more > plain, `${String(more)} should be more than ${String(plain)}`);
  });

  it("a pot held back at the top gets a smaller amount", () => {
    const input = { style: "let_top_dry", potDiameterCm: 15 } as const;
    const m = startMultipliers({ potDiameterCm: 30, light: "low" });
    assert.equal(m.clamped, "high");
    const plain = wateringHint(input).volumeMl ?? 0;
    const less = wateringHint({ ...input, amountFactor: m.amountFactor }).volumeMl ?? Infinity;
    assert.ok(less < plain);
  });

  it("the amount correction is limited to half and twice the usual amount", () => {
    const tiny = startMultipliers({ potDiameterCm: 4, light: "direct", potMaterial: "terracotta" });
    assert.equal(tiny.amountFactor, 2);
    const huge = startMultipliers({ potDiameterCm: 60, light: "low" });
    assert.equal(huge.amountFactor, 0.5);
  });

  it("nothing is clipped, so nothing moves into the amount, while the product is inside the range", () => {
    for (const d of [10, 15, 20, 24]) {
      const m = startMultipliers({ potDiameterCm: d });
      assert.equal(m.clamped, null);
      assert.equal(m.amountFactor, 1);
      assert.equal(m.factor, m.raw);
    }
  });

  it("junk input counts as unknown", () => {
    assert.equal(startMultipliers({ potDiameterCm: -3 }).potSize, 1);
    assert.equal(startMultipliers({ potDiameterCm: Number.NaN }).potSize, 1);
    assert.equal(startMultipliers({ potDiameterCm: 0 }).raw, 1);
  });
});

describe("start multipliers in the windows", () => {
  const monstera: PlantInput = {
    id: "m",
    style: "let_top_dry",
    intervalDays: 10,
    lastWatered: "2026-11-02",
  };
  const earliest = (p: PlantInput): string | undefined =>
    computeWindows({ today: "2026-11-02", plants: [p] }).windows[0]?.earliest;

  it("a plant with none of the facts keeps the catalogue interval", () => {
    assert.equal(earliest(monstera), "2026-11-09"); // 10 days less 25% (3, rounded half up)
    assert.equal(earliest({ ...monstera, potDiameterCm: 15, light: "medium" }), "2026-11-09");
  });

  it("a 12 cm pot dries sooner than a 15 cm one, and the window moves with it", () => {
    const small = earliest({ ...monstera, potDiameterCm: 12 }) ?? "";
    assert.ok(small < "2026-11-09", small);
  });

  it("learning still nudges the multiplied interval, one honest log at a time", () => {
    const withMultiplier = { ...monstera, potDiameterCm: 18 }; // working interval 12
    const wet = {
      ...withMultiplier,
      logs: [{ date: "2026-11-14", outcome: "still_wet" as const }],
    };
    const w0 = computeWindows({ today: "2026-11-14", plants: [withMultiplier] }).windows[0];
    const w1 = computeWindows({ today: "2026-11-14", plants: [wet] }).windows[0];
    assert.ok(w0 !== undefined && w1 !== undefined);
    assert.ok(w1.latest > w0.latest, "still wet lengthens the learned interval");
    const dry = {
      ...withMultiplier,
      logs: [{ date: "2026-11-12", outcome: "dry_early" as const }],
    };
    const w2 = computeWindows({ today: "2026-11-12", plants: [dry] }).windows[0];
    const w3 = computeWindows({ today: "2026-11-12", plants: [withMultiplier] }).windows[0];
    assert.ok(w2 !== undefined && w3 !== undefined);
    assert.ok(w2.latest < w3.latest, "dry early shortens it");
  });
});
