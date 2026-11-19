// SPDX-License-Identifier: AGPL-3.0-only

/** Calendar export (C13): the planned watering days as an all-day-event `.ics` file (RFC 5545). */
import type { PlanResult } from "@green-garden/engine";
import { fold, planToIcs, type AppData } from "@green-garden/storage";
import { t } from "./text.ts";

export { fold };

/** The shared generator (storage) with the UI's translated event title. */
export function toIcs(plan: PlanResult, data: AppData, today: string): string {
  return planToIcs(plan, data, today, (n) => t("ics.summary", { n }));
}
