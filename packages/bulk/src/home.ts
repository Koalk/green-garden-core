// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Q-K0, the home question, as pure state. It is asked once: in Settings, and as a gate
 * before the first plant outdoors is saved while `settings.climate` is unset. The engine's `oceanic_wet`
 * stays only as the fallback for imports and older data; nothing here ever saves it silently.
 * The markup stays in web-ui (and, later, the Stories app); the rules live here so both share them.
 */
import {
  HOME_REGIONS,
  followUpFor,
  homeFor,
  type Home,
  type HomeFollowUp,
  type HomeRegion,
} from "@green-garden/questions";
import {
  CLIMATES,
  WINTER_MINS,
  spaceView,
  type AppData,
  type Plant,
  type Settings,
  type WinterMin,
} from "@green-garden/storage";

type Climate = NonNullable<Settings["climate"]>;

/** True for the placements the outdoor care rules apply to. */
export function isOutdoorPlacement(placement: Plant["placement"] | undefined): boolean {
  return placement === "ground" || placement === "outdoor_pot";
}

/**
 * Whether saving `after` must first ask Q-K0: no climate is set yet and a plant is outdoors that was not
 * outdoors in `before` (a new plant, an edit, a bulk add, or an answer that moves a plant outside).
 */
export function homeQuestionNeeded(before: AppData, after: AppData): boolean {
  if (after.settings.climate !== undefined) return false;
  const wasOutdoors = new Set(
    before.plants.filter((p) => isOutdoorPlacement(p.placement)).map((p) => p.id),
  );
  return after.plants.some((p) => isOutdoorPlacement(p.placement) && !wasOutdoors.has(p.id));
}

/** What the person has picked so far; the suggestion fills `climate` and `winterMin`, both changeable. */
export interface HomeDraft {
  readonly regionId?: string;
  /** Follow-up option ids, in the order of the region's follow-ups. */
  readonly answers: readonly string[];
  readonly climate?: Climate;
  readonly winterMin?: WinterMin;
}

export function draftFromSettings(s: Pick<Settings, "climate" | "winterMin">): HomeDraft {
  return {
    answers: [],
    ...(s.climate === undefined ? {} : { climate: s.climate }),
    ...(s.winterMin === undefined ? {} : { winterMin: s.winterMin }),
  };
}

export { HOME_REGIONS };
export type { Home, HomeFollowUp, HomeRegion };

/** The follow-ups to ask for the draft's region, in order (none before a region is picked). */
export function followUpsOf(d: HomeDraft): readonly HomeFollowUp[] {
  return d.regionId === undefined ? [] : followUpFor(d.regionId);
}

/** The suggested home for the region and the answers so far; undefined while a required answer is missing. */
export function suggestionOf(d: HomeDraft): Home | undefined {
  return d.regionId === undefined ? undefined : homeFor(d.regionId, ...d.answers);
}

/** A suggestion, when there is one, replaces both values; otherwise they stay as they were. */
function suggested(d: HomeDraft): HomeDraft {
  const s = suggestionOf(d);
  return s === undefined ? d : { ...d, climate: s.climate, winterMin: s.winterMin };
}

/** A new region drops the old answers and takes its own suggestion. */
export function pickRegion(d: HomeDraft, regionId: string): HomeDraft {
  if (!HOME_REGIONS.some((r) => r.id === regionId)) return d;
  return suggested({ regionId, answers: [] });
}

/** Answers follow-up number `index`; answers after it are dropped, since they may no longer apply. */
export function answerFollowUp(d: HomeDraft, index: number, optionId: string): HomeDraft {
  const ups = followUpsOf(d);
  const up = ups[index];
  if (up === undefined || !up.options.some((o) => o.id === optionId)) return d;
  const answers = [...d.answers.slice(0, index), optionId];
  return suggested({ ...d, answers });
}

export function pickClimate(d: HomeDraft, climate: string): HomeDraft {
  const known = CLIMATES.find((c) => c === climate);
  return known === undefined ? d : { ...d, climate: known };
}

export function pickWinterMin(d: HomeDraft, winterMin: string): HomeDraft {
  const known = WINTER_MINS.find((w) => w === winterMin);
  return known === undefined ? d : { ...d, winterMin: known };
}

/**
 * Saves the answer as the two home settings. The region's country is kept only when none is set, so a
 * country chosen in Settings is never overwritten. Undefined while either value is missing.
 */
export function saveHome(data: AppData, d: HomeDraft): AppData | undefined {
  if (d.climate === undefined || d.winterMin === undefined) return undefined;
  const region = HOME_REGIONS.find((r) => r.id === d.regionId);
  const country = data.settings.country ?? region?.country;
  return {
    ...data,
    settings: {
      ...data.settings,
      climate: d.climate,
      winterMin: d.winterMin,
      ...(country === undefined ? {} : { country }),
    },
  };
}

/** The climate the plan uses for the active space: the home answer, if given. */
export function homeClimate(data: AppData): Climate | undefined {
  return spaceView(data).settings.climate;
}
