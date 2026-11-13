// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two seasonal cards on Today. The engine's `seasonalPrompts` decides which plants get
 * one; this file builds the markup and keeps "Not yet" and "Leave it out" (web app state, in localStorage).
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
  return choice === "snooze"
    ? { ...state, snoozedUntil: { ...state.snoozedUntil, [plantId]: snoozeUntil(today) } }
    : {
        ...state,
        leftOutUntil: { ...state.leftOutUntil, [plantId]: leaveOutUntil(today, hemisphere) },
      };
}

const KEY = "gg.seasonal";

export function loadCardState(): SeasonalState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? emptyCardState() : (JSON.parse(raw) as SeasonalState);
  } catch {
    return emptyCardState();
  }
}

export function saveCardState(state: SeasonalState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage can be blocked; the card then returns on the next visit */
  }
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
