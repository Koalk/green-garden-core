// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Outdoor care on the screens.
 * View models and markup for plants outdoors: the rain-fed and resting lines, the drought check and the
 * optional winter soak, "It rained", the forecast hint, the "assumed" chip and bed amounts. Everything
 * is read from the plan the engine returned; nothing here changes it. Indoor plants produce no markup.
 */
import { isOutdoorPlacement } from "@green-garden/bulk";
import { resolveCare, type PlanResult } from "@green-garden/engine";
import { buildPlanInput, spaceView, type AppData, type Plant } from "@green-garden/storage";
import type { SpeciesRow } from "./pilot-data.ts";
import { esc, t, tHtml } from "./text.ts";

/** "It rained" buttons: light, proper, downpour (02k 2.3). PROVISIONAL: the mm are guesses. */
export const RAIN_SIZES = [
  { id: "light", mm: 5 },
  { id: "proper", mm: 12 },
  { id: "downpour", mm: 25 },
] as const;

/** Rain only counts for a plant outdoors that is not under cover (indoor and sheltered plants: hidden). */
export function canLogRain(plant: Pick<Plant, "placement" | "sheltered">): boolean {
  return isOutdoorPlacement(plant.placement) && plant.sheltered !== true;
}

export interface OutdoorStatus {
  readonly kind: "rain_fed" | "dormant";
  /** The calm line; never a task. */
  readonly line: string;
  /** Rain-fed: a long dry spell, so ask whether it looks well. */
  readonly drought: boolean;
  /** Resting: dry for a month, so offer an optional winter soak. */
  readonly soak: boolean;
  readonly assumed: readonly string[];
}

/** What the plan says about an outdoor plant that has no watering window; undefined for the rest. */
export function outdoorStatus(plan: PlanResult, plantId: string): OutdoorStatus | undefined {
  const fed = plan.rainFed.find((r) => r.plantId === plantId);
  if (fed !== undefined) {
    return {
      kind: "rain_fed",
      line: t("outdoor.rainFed"),
      drought: fed.droughtCheck,
      soak: false,
      assumed: fed.assumed,
    };
  }
  const rest = plan.dormant.find((r) => r.plantId === plantId);
  if (rest === undefined) return undefined;
  return {
    kind: "dormant",
    line:
      rest.until === null
        ? t("outdoor.dormantNoDate")
        : t("outdoor.dormantUntil", { until: rest.until }),
    drought: false,
    soak: rest.winterSoak,
    assumed: rest.assumed,
  };
}

/** "Rain forecast: you may wait", only for the plants the plan names. A hint, never a change to the plan. */
export function forecastHint(plan: PlanResult, plantId: string): string | undefined {
  return plan.rainForecastFor.includes(plantId) ? t("outdoor.forecast") : undefined;
}

const ASSUMABLE = ["droughtTolerance", "rootDepth", "establishingIntervalDays", "phase"] as const;

/** The "assumed" chip: some care facts of this plant are defaults until the catalogue or the person says. */
export function assumedChipHtml(assumed: readonly string[]): string {
  const known = ASSUMABLE.filter((k) => assumed.includes(k));
  if (known.length === 0) return "";
  const what = known.map((k) => t(`outdoor.assumed.${k}`)).join(", ");
  return `<span class="assumed" title="${tHtml("outdoor.assumedTitle", { what })}">${esc(t("outdoor.assumed"))}</span>`;
}

/**
 * Bed watering in household words (02k 1.3): watering cans or a slow time with the hose, never ml.
 * Only for plants in the ground; pots outside keep the usual amount lines. PROVISIONAL: the counts.
 */
export function bedAmountWords(plant: Pick<Plant, "placement" | "rootDepth">): string | undefined {
  if (plant.placement !== "ground") return undefined;
  const [cans, minutes] =
    plant.rootDepth === "shallow" ? [1, 5] : plant.rootDepth === "deep" ? [3, 15] : [2, 10];
  return t("outdoor.bed.line", { cans: t("outdoor.bed.cans", { n: cans }), minutes });
}

function rainButtons(action: "rain" | "rain-all", id: string | undefined, name: string): string {
  const who = id === undefined ? "" : ` data-id="${esc(id)}"`;
  const buttons = RAIN_SIZES.map((s) => {
    const label = t(`outdoor.rain.${s.id}`);
    const aria =
      id === undefined
        ? tHtml("outdoor.rain.ariaAll", { label })
        : tHtml("outdoor.rain.aria", { label, name });
    return `<button type="button" class="secondary" data-action="${action}"${who} data-mm="${s.mm}" aria-label="${aria}">${esc(label)}</button>`;
  }).join(" ");
  return `<span class="rain"><small>${esc(t("outdoor.rained"))}</small> ${buttons}</span>`;
}

/** "It rained" for one plant (its details). */
export function rainButtonsHtml(plantId: string, name: string): string {
  return rainButtons("rain", plantId, name);
}

function checkButtons(plantId: string, name: string): string {
  const b = (outcome: "looks_fine" | "done", label: string): string =>
    `<button type="button" data-action="log" data-id="${esc(plantId)}" data-outcome="${outcome}" aria-label="${tHtml("outcome.aria", { label, name })}">${esc(label)}</button>`;
  return `${b("looks_fine", t("outdoor.looksFine"))} ${b("done", t("outdoor.watered"))}`;
}

/** Facts the engine used for this plant when it is on a schedule: which of them were assumed. */
function scheduledAssumed(data: AppData, plantId: string, today: string): readonly string[] {
  const input = buildPlanInput(data, today);
  const p = (input.plants ?? []).find((x) => x.id === plantId);
  if (p === undefined) return [];
  return resolveCare(p, today, {
    ...(input.climate === undefined ? {} : { climate: input.climate }),
    ...(input.hemisphere === undefined ? {} : { hemisphere: input.hemisphere }),
    ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
  }).assumed;
}

/**
 * The outdoor part of a plant card: the rain-fed or resting line, the check or soak with its two
 * buttons, the forecast hint, the "assumed" chip and "It rained". Empty for a plant indoors.
 */
export function outdoorBlockHtml(
  plan: PlanResult,
  data: AppData,
  plant: Plant,
  today: string,
  opts: { readonly rain?: boolean } = {},
): string {
  if (!isOutdoorPlacement(plant.placement)) return "";
  const status = outdoorStatus(plan, plant.id);
  const assumed = status?.assumed ?? scheduledAssumed(data, plant.id, today);
  const hint = forecastHint(plan, plant.id);
  const parts: string[] = [];
  if (status !== undefined) {
    parts.push(`<p class="outdoor-line">${esc(status.line)} ${assumedChipHtml(assumed)}</p>`);
    if (status.drought) {
      parts.push(
        `<p><small>${esc(t("outdoor.droughtCheck"))}</small><br>${checkButtons(plant.id, plant.name)}</p>`,
      );
    }
    if (status.soak) {
      parts.push(
        `<p><small>${esc(t("outdoor.winterSoak"))}</small><br>${checkButtons(plant.id, plant.name)}</p>`,
      );
    }
  } else if (assumed.length > 0) {
    parts.push(`<p class="outdoor-line">${assumedChipHtml(assumed)}</p>`);
  }
  if (hint !== undefined) parts.push(`<p><small>${esc(hint)}</small></p>`);
  if (opts.rain !== false && canLogRain(plant))
    parts.push(`<p>${rainButtonsHtml(plant.id, plant.name)}</p>`);
  return parts.length === 0 ? "" : `<div class="outdoor">${parts.join("")}</div>`;
}

/**
 * Today's "Outdoors" block: the plants that want a look (drought check, winter soak), a quiet count of
 * the rest, and one "It rained" row for every plant that rain reaches, then the rain detail with its
 * marks and credits when weather is on. Empty when nothing is outdoors.
 */
export function todayOutdoorHtml(plan: PlanResult, data: AppData, rainDetail = ""): string {
  const outdoors = spaceView(data).plants.filter((p) => isOutdoorPlacement(p.placement));
  const looks: string[] = [];
  let calm = 0;
  for (const p of outdoors) {
    const s = outdoorStatus(plan, p.id);
    if (s === undefined) continue;
    if (!s.drought && !s.soak) {
      calm += 1;
      continue;
    }
    const why = t(s.drought ? "outdoor.droughtCheck" : "outdoor.winterSoak");
    looks.push(
      `<li><strong>${esc(p.name)}</strong> ${esc(s.line)}<br><small>${esc(why)}</small><br>${checkButtons(p.id, p.name)}</li>`,
    );
  }
  const exposed = outdoors.some(canLogRain);
  if (looks.length === 0 && calm === 0 && !exposed) return "";
  return `<section id="outdoors"><h3>${esc(t("outdoor.todayHeading"))}</h3>
    ${looks.length === 0 ? "" : `<ul>${looks.join("")}</ul>`}
    ${calm === 0 ? "" : `<p><small>${esc(t("outdoor.todayCalm", { n: calm }))}</small></p>`}
    ${exposed ? `<p>${rainButtons("rain-all", undefined, "")}</p>` : ""}${rainDetail}</section>`;
}

type CatalogueRow = Pick<SpeciesRow, "outdoor"> | undefined;

/**
 * Copies the outdoor care facts of the catalogue entry onto a plant that is being added, so the
 * engine can read them if the plant is, or later becomes, an outdoor one. What the plant already says
 * stays; an entry with none of them changes nothing.
 */
export function withCatalogueOutdoor<T extends object>(plant: T, row: CatalogueRow): T {
  const fill = row?.outdoor;
  if (fill === undefined) return plant;
  const missing = Object.fromEntries(
    Object.entries(fill).filter(([k]) => plant[k as keyof T] === undefined),
  );
  return Object.keys(missing).length === 0 ? plant : { ...plant, ...missing };
}

/** What a watering that is due today also says for an outdoor plant: the forecast hint and the "assumed" chip. */
export function dueExtrasHtml(
  plan: PlanResult,
  data: AppData,
  plant: Plant,
  today: string,
): string {
  if (!isOutdoorPlacement(plant.placement)) return "";
  const hint = forecastHint(plan, plant.id);
  const chip = assumedChipHtml(scheduledAssumed(data, plant.id, today));
  if (hint === undefined && chip === "") return "";
  return `<br><small>${hint === undefined ? "" : esc(hint)}</small> ${chip}`;
}
