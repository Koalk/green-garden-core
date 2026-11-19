// SPDX-License-Identifier: AGPL-3.0-only

import { lightByHours } from "./sun.ts";
import type { Light, PotMaterial, StartFacts, StartMultipliers } from "./types.ts";

// PROVISIONAL: every number here is a guess (drying physics), not
// a measured value. The scaling laws are explainable; the absolute levels wait for real dry-downs.

/** Pot diameter the catalogue intervals are taken to be for. */
export const REFERENCE_DIAMETER_CM = 15;
/** Exponent of the diameter ratio (between 1 and 2, start 1.0). */
const POT_SIZE_EXPONENT = 1;
/** Light, relative to medium: dim stretches the interval, strong light shortens it. */
const LIGHT_FACTOR: Record<Light, number> = {
  low: 1.6,
  medium: 1,
  bright_indirect: 0.65,
  direct: 0.4,
};
/** Pot material (terracotta 0.7; fabric dries through its walls the same way, a guess). */
const MATERIAL_FACTOR: Record<PotMaterial, number> = {
  plastic: 1,
  glazed: 1,
  other: 1,
  terracotta: 0.7,
  fabric: 0.7,
};

/** The product of the multipliers is held to this range of the catalogue interval. */
export const MULTIPLIER_MIN = 0.6;
export const MULTIPLIER_MAX = 1.6;
/**
 * What the clamp removes moves into the amount per watering, but never past half or twice the usual
 * amount: the soil can only hold so much, and "water until it runs out" stays the real instruction.
 */
const AMOUNT_MIN = 0.5;
const AMOUNT_MAX = 2;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function lookup<K extends string>(table: Record<K, number>, key: K | undefined): number {
  return key === undefined ? 1 : ((table as Record<string, number>)[key] ?? 1);
}

/**
 * The start multipliers on a plant's catalogue interval: pot size against a
 * 15 cm reference, room light and pot material, each a guess. Unknown facts count as 1, so a plant we
 * know nothing about keeps its catalogue interval. The product is clamped to 0.6 to 1.6; when the clamp
 * bites, the clipped part moves into the amount per watering instead of being lost: a pot
 * that wants water every 0.4 of the interval but is held to 0.6 gets 0.6 / 0.4 of the usual amount each
 * time, a pot held back at the top gets less. Values are rounded to three decimals.
 */
export function startMultipliers(facts: StartFacts): StartMultipliers {
  const d = facts.potDiameterCm;
  const potSize =
    d !== undefined && Number.isFinite(d) && d > 0
      ? (d / REFERENCE_DIAMETER_CM) ** POT_SIZE_EXPONENT
      : 1;
  const classLight = lookup(LIGHT_FACTOR, facts.light);
  // direct-sun hours pull the class factor towards `direct`, saturating at 4 hours.
  const light =
    facts.sunHours !== undefined && Number.isFinite(facts.sunHours) && facts.sunHours > 0
      ? lightByHours(classLight, LIGHT_FACTOR.direct, facts.sunHours)
      : classLight;
  const material = lookup(MATERIAL_FACTOR, facts.potMaterial);
  const raw = potSize * light * material;
  const factor = Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, raw));
  const clamped = raw < MULTIPLIER_MIN ? "low" : raw > MULTIPLIER_MAX ? "high" : null;
  const amountFactor =
    clamped === null ? 1 : Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, factor / raw));
  return {
    potSize: round3(potSize),
    light,
    material,
    raw: round3(raw),
    factor: round3(factor),
    clamped,
    amountFactor: round3(amountFactor),
    guess: true,
  };
}
