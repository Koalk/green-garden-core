// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "How much" text for the web UI (02h). The wording lives in `@green-garden/care-text` (shared
 * with the Stories app); this module binds it to the active locale so call sites stay `amountLines(input, prefs)`.
 */
import {
  amountLines as careAmountLines,
  amountNoteFor as careAmountNoteFor,
  amountText as careAmountText,
  DEFAULT_AMOUNT_PREFS,
  type AmountInput,
  type AmountLines,
  type AmountPrefs,
} from "@green-garden/care-text";
import type { AppData, Plant } from "@green-garden/storage";
import { t } from "./text.ts";

export {
  amountInputFor,
  amountPrefs,
  calibrationFromMeasurement,
  calibrationsFor,
  containerMl,
  DEFAULT_AMOUNT_PREFS,
  DRAINAGES,
  linesText,
  MEASURES,
  type AmountInput,
  type AmountLines,
  type AmountMode,
  type AmountPrefs,
  type Drainage,
  type Measure,
  type Wording,
} from "@green-garden/care-text";

export function amountLines(input: AmountInput, prefs: AmountPrefs): AmountLines {
  return careAmountLines(t, input, prefs);
}

/** The "How much" line as one text. */
export function amountText(input: AmountInput, prefs: AmountPrefs = DEFAULT_AMOUNT_PREFS): string {
  return careAmountText(t, input, prefs);
}

/** The quiet line for the plant dialog: about this plant, or the invitation to measure for a new one. */
export function amountNoteFor(data: AppData, plant: Plant | undefined): string | undefined {
  return careAmountNoteFor(t, data, plant);
}
