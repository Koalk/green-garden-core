// SPDX-License-Identifier: AGPL-3.0-only

/** The web UI's side of the health check prompt: gathers what core's care text needs. */
import { healthCheckFacts, healthCheckText, healthSearchText } from "@green-garden/care-text";
import { improveRows } from "@green-garden/bulk";
import { getLocale } from "@green-garden/i18n";
import type { AppData } from "@green-garden/storage";
import { SPECIES } from "./pilot-data.ts";
import { normalise } from "./species.ts";
import { t } from "./text.ts";

/** The chat prompt and the short web search for one plant; `undefined` for an unknown plant. */
export function healthTexts(
  data: AppData,
  plantId: string,
  today: string,
  symptoms: string,
): { readonly chat: string; readonly search: string } | undefined {
  const plant = data.plants.find((p) => p.id === plantId);
  if (plant === undefined) return undefined;
  const key = normalise(plant.species ?? "");
  const row = key === "" ? undefined : SPECIES.find((r) => normalise(r.scientificName) === key);
  const open = improveRows(data, today).find((r) => r.plant.id === plantId);
  const facts = healthCheckFacts(t, data, plantId, today, {
    locale: getLocale(),
    ...(row === undefined
      ? {}
      : { commonName: row.commonNames[0] ?? row.name, scientificName: row.scientificName }),
    openItems: (open?.questions ?? []).map((q) => t(`detail.row.${q.id}`)),
  });
  if (facts === undefined) return undefined;
  return {
    chat: healthCheckText(t, facts, symptoms),
    search: healthSearchText(t, facts, symptoms),
  };
}
