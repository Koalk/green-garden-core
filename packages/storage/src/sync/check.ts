// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The next-date check between two devices (household sync). Each device can send, per plant, a small
 * number worked out from the plant's replayed next date and its engine version. A receiver that
 * replays the same entries to another number is running another engine: it gets data back, no
 * decision is made here and nothing blocks.
 */
import { computeWindows, nextDateCheck } from "@green-garden/engine";
import { buildPlanInput } from "../calendar.ts";
import type { AppData } from "../model.ts";

/** A plant whose check differs from the other device's. */
export interface EngineMismatch {
  readonly kind: "engine-mismatch";
  readonly plantId: string;
  readonly mine: number;
  readonly theirs: number;
}

/**
 * One check value per plant that has a window (the active space). The next date is the window's
 * earliest and latest day, so it depends on `today` only for a plant already overdue.
 */
export function nextDateChecks(data: AppData, today: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of computeWindows(buildPlanInput(data, today)).windows) {
    out[w.plantId] = nextDateCheck(w.plantId, `${w.earliest}/${w.latest}`);
  }
  return out;
}

/**
 * Compares the other device's check values with this device's. Only plants both sides know are
 * compared; a plant either side sends no value for is not a mismatch. Sorted by plant ID.
 */
export function checkNextDates(
  data: AppData,
  today: string,
  theirs: Readonly<Record<string, number>>,
): EngineMismatch[] {
  const mine = nextDateChecks(data, today);
  return Object.keys(theirs)
    .sort()
    .flatMap((plantId): EngineMismatch[] => {
      const a = mine[plantId];
      const b = theirs[plantId];
      return a === undefined || b === undefined || a === b
        ? []
        : [{ kind: "engine-mismatch", plantId, mine: a, theirs: b }];
    });
}
