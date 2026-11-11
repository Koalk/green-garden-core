// SPDX-License-Identifier: AGPL-3.0-only

import type {
  CalibrationLevel,
  HintInput,
  HouseholdMeasure,
  WateringHint,
  WateringStyle,
} from "./types.ts";

// PROVISIONAL: midpoints of the 02a 4.2 heuristic fractions of soil volume. The fractions
// have no authoritative source and need a measuring-jug check on real pots.
const FRACTION: Record<WateringStyle, number> = {
  keep_moist: 0.125,
  let_top_dry: 0.225,
  let_fully_dry: 0.325,
};

/**
 * Approximate watering amount (02a section 4). Pot volume from a tapered-pot frustum:
 * height 0.85 x diameter if not given, bottom diameter 0.7 x top, soil 90% of the volume.
 * Volumes under 100 ml are not shown (noise); no diameter means no volume.
 */
export function wateringHint(input: HintInput): WateringHint {
  const d = input.potDiameterCm;
  let estimate: number | undefined;
  if (d !== undefined && Number.isFinite(d) && d > 0) {
    const h =
      input.potHeightCm !== undefined && input.potHeightCm > 0 ? input.potHeightCm : 0.85 * d;
    const bigR = d / 2;
    const smallR = (0.7 * d) / 2;
    const volumeMl = ((Math.PI * h) / 3) * (bigR * bigR + bigR * smallR + smallR * smallR);
    // what the start multipliers' clamp moved into the amount; a measurement below is never scaled.
    const af = input.amountFactor;
    const correction = af !== undefined && Number.isFinite(af) && af > 0 ? af : 1;
    estimate = volumeMl * 0.9 * FRACTION[input.style] * correction;
  }
  let water = estimate;
  let level: CalibrationLevel | null = null;
  for (const l of LEVELS) {
    const c = input.calibration?.[l];
    if (c === undefined) continue;
    if (c.measuredMl !== undefined && Number.isFinite(c.measuredMl) && c.measuredMl > 0) {
      water = c.measuredMl;
      level = l;
      break;
    }
    // A factor scales the estimate, so it needs a pot size to scale.
    if (
      c.factor !== undefined &&
      Number.isFinite(c.factor) &&
      c.factor > 0 &&
      estimate !== undefined
    ) {
      // The factor scales the amount as shown (rounded to 50 ml), so "that was half of what it said"
      // means what it says.
      water = round50(estimate) * c.factor;
      level = l;
      break;
    }
  }
  if (water === undefined || water < 100) {
    return {
      style: input.style,
      volumeMl: null,
      measure: null,
      calibration: null,
      adjust: null,
      provisional: true,
    };
  }
  const rounded = round50(water);
  return {
    style: input.style,
    volumeMl: rounded,
    measure: householdMeasure(rounded),
    calibration: level,
    adjust: level === null ? adjustOf(input.amountFactor) : null,
    provisional: true,
  };
}

/** "more" or "less" only when the correction is big enough to be worth a word (10% or more). */
function adjustOf(factor: number | undefined): "more" | "less" | null {
  if (factor === undefined || !Number.isFinite(factor)) return null;
  return factor >= 1.1 ? "more" : factor <= 0.9 ? "less" : null;
}

const round50 = (ml: number): number => Math.floor(ml / 50 + 0.5) * 50;

// Most specific first.
const LEVELS: readonly CalibrationLevel[] = ["plant", "room", "global"];

const HALF_CUP_ML = 120;

/**
 * PROVISIONAL: users see a household measure, not ml. A cup is 240 ml, the
 * volume is rounded to half cups, and big pots fall back to half litres of a measuring jug. The engine
 * returns the unit and count only; the UI words it per locale. The wording waits for and the
 * jug experiment (02d).
 */
function householdMeasure(volumeMl: number): HouseholdMeasure {
  const halves = Math.max(1, Math.round(volumeMl / HALF_CUP_ML));
  if (halves > 16) return { unit: "litre", count: Math.round(volumeMl / 500) / 2 };
  return { unit: "cup", halves };
}
