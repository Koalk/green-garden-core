// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two seasonal cards on Today. The engine's `seasonalPrompts` decides which plants get
 * one; this file builds the markup and keeps "Not yet" and "Leave it out" in the data (`AppData.seasonal`),
 * so the choices survive a reload and travel in the export.
 */
import {
  leaveOutUntil,
  seasonalPrompts,
  snoozeUntil,
  type SeasonalPrompt,
  type SeasonalState,
  type WeatherDay,
} from "@green-garden/engine";
import { homeLatitude, type AppData, type Plant } from "@green-garden/storage";
import { formatDate, parseDate } from "@green-garden/engine";
import { SPECIES } from "./pilot-data.ts";
import { normalise } from "./species.ts";
import { esc, t } from "./text.ts";

export function emptyCardState(): SeasonalState {
  return {};
}

export type CardChoice = "snooze" | "leave";

/** The state after "Not yet" (7 days) or "Leave it out" (until 1 July north, 1 January south). */
export function applyCardChoice(
  state: SeasonalState,
  plantId: string,
  choice: CardChoice,
  today: string,
  hemisphere: "north" | "south",
): SeasonalState {
  const live = (r: SeasonalState["snoozedUntil"]): Record<string, string> =>
    Object.fromEntries(Object.entries(r ?? {}).filter(([, day]) => day >= today));
  const kept = { snoozedUntil: live(state.snoozedUntil), leftOutUntil: live(state.leftOutUntil) };
  const next =
    choice === "snooze"
      ? { ...kept, snoozedUntil: { ...kept.snoozedUntil, [plantId]: snoozeUntil(today) } }
      : {
          ...kept,
          leftOutUntil: { ...kept.leftOutUntil, [plantId]: leaveOutUntil(today, hemisphere) },
        };
  return {
    ...(Object.keys(next.snoozedUntil).length === 0 ? {} : { snoozedUntil: next.snoozedUntil }),
    ...(Object.keys(next.leftOutUntil).length === 0 ? {} : { leftOutUntil: next.leftOutUntil }),
  };
}

/** The cards' choices held in the data. */
export function cardStateOf(data: AppData): SeasonalState {
  return data.seasonal ?? emptyCardState();
}

/** The data after "Not yet" or "Leave it out" for one plant. */
export function chooseCard(
  data: AppData,
  plantId: string,
  choice: CardChoice,
  today: string,
): AppData {
  return {
    ...data,
    seasonal: applyCardChoice(cardStateOf(data), plantId, choice, today, data.settings.hemisphere),
  };
}

/** The data without one plant's choices (its place changed, so the old answer no longer holds). */
export function clearCardChoices(data: AppData, plantId: string): AppData {
  if (data.seasonal === undefined) return data;
  const without = (r: SeasonalState["snoozedUntil"]): Record<string, string> =>
    Object.fromEntries(Object.entries(r ?? {}).filter(([id]) => id !== plantId));
  const snoozedUntil = without(data.seasonal.snoozedUntil);
  const leftOutUntil = without(data.seasonal.leftOutUntil);
  const seasonal = {
    ...(Object.keys(snoozedUntil).length === 0 ? {} : { snoozedUntil }),
    ...(Object.keys(leftOutUntil).length === 0 ? {} : { leftOutUntil }),
  };
  const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "seasonal"));
  return (Object.keys(seasonal).length === 0 ? rest : { ...rest, seasonal }) as unknown as AppData;
}

const KEY = "gg.seasonal";

/** What an earlier build kept in this browser, if anything (read once, then removed). */
export function readLegacyCardState(): SeasonalState | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? undefined : (JSON.parse(raw) as SeasonalState);
  } catch {
    return undefined;
  }
}

export function dropLegacyCardState(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to remove */
  }
}

/** The data with the old per-browser choices adopted, or undefined when there is nothing to adopt. */
export function adoptLegacyCardState(
  data: AppData,
  legacy: SeasonalState | undefined,
): AppData | undefined {
  if (legacy === undefined || data.seasonal !== undefined) return undefined;
  const ok = (r: SeasonalState["snoozedUntil"]): Record<string, string> =>
    Object.fromEntries(
      Object.entries(r ?? {}).filter(
        ([, day]) =>
          typeof day === "string" &&
          parseDate(day) !== undefined &&
          formatDate(parseDate(day) ?? 0) === day,
      ),
    );
  const snoozedUntil = ok(legacy.snoozedUntil);
  const leftOutUntil = ok(legacy.leftOutUntil);
  if (Object.keys(snoozedUntil).length + Object.keys(leftOutUntil).length === 0) return undefined;
  return {
    ...data,
    seasonal: {
      ...(Object.keys(snoozedUntil).length === 0 ? {} : { snoozedUntil }),
      ...(Object.keys(leftOutUntil).length === 0 ? {} : { leftOutUntil }),
    },
  };
}

/** The cards to show today for this data. */
export function cardPrompts(
  data: AppData,
  weather: readonly WeatherDay[],
  today: string,
  state: SeasonalState,
): SeasonalPrompt[] {
  const s = data.settings;
  const latitude = homeLatitude(s);
  return seasonalPrompts({
    plants: data.plants,
    speciesOf: (p) => {
      const q = normalise((p as Plant).species ?? "");
      const row =
        q === ""
          ? undefined
          : SPECIES.find((r) => normalise(r.scientificName) === q || normalise(r.name) === q);
      return row === undefined ? undefined : { tags: row.tags };
    },
    home: {
      hemisphere: s.hemisphere,
      ...(latitude === undefined ? {} : { latitude }),
      ...(s.winterMin === undefined ? {} : { winterMin: s.winterMin }),
    },
    weather,
    today,
    state,
  });
}

export function cardsHtml(prompts: readonly SeasonalPrompt[], plants: readonly Plant[]): string {
  const cards = prompts
    .map((p) => {
      const plant = plants.find((x) => x.id === p.plantId);
      if (plant === undefined) return "";
      const id = esc(plant.id);
      const who = esc(plant.name);
      const bring = p.kind === "bring_in";
      const move = t(bring ? "move.bringIn" : "move.putOut");
      const text = t(bring ? "season.bringIn" : "season.putOut", { name: plant.name });
      return `<li class="card season" data-kind="${p.kind}"><p>${esc(text)}</p>
        <button data-action="season-move" data-id="${id}" aria-label="${esc(move)}: ${who}">${esc(move)}</button>
        <button data-action="season-snooze" data-id="${id}" aria-label="${esc(t("season.notYet"))}: ${who}">${esc(t("season.notYet"))}</button>
        <button data-action="season-leave" data-id="${id}" aria-label="${esc(t("season.leave"))}: ${who}">${esc(t("season.leave"))}</button></li>`;
    })
    .join("");
  return cards === "" ? "" : `<ul class="season-cards">${cards}</ul>`;
}
