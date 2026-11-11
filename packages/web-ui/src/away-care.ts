// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What a person can do for their plants while nobody can water (features/02b-away-care-options.md),
 * filtered by watering style and by how long the stretch is. Physical measures only. A bath, matting or a
 * reservoir is never offered for plants that like to dry out. PROVISIONAL: lengths and choices are
 * from extension pages and author knowledge, flagged in 02b.
 */
import { formatDate, parseDate } from "@green-garden/engine";
import { spaceView, type AppData, type Plant } from "@green-garden/storage";
import { esc, t, tHtml } from "./text.ts";

export type AwaySuggestion =
  | "nothing_needed"
  | "water_before"
  | "cooler_spot"
  | "pebble_tray"
  | "matting"
  | "wick"
  | "reservoir"
  | "sitter_visit"
  | "sitter_home";

type Style = Plant["style"];

/** Suggestions for `style` when away for `days` days, most useful first. */
export function awayCare(style: Style, days: number): AwaySuggestion[] {
  if (days > 28) return ["sitter_home", "sitter_visit"];
  if (style === "let_fully_dry") {
    if (days <= 7) return ["nothing_needed"];
    if (days <= 14) return ["water_before", "cooler_spot"];
    return ["cooler_spot", "sitter_visit"];
  }
  if (style === "let_top_dry") {
    if (days <= 3) return ["nothing_needed"];
    if (days <= 7) return ["water_before", "cooler_spot"];
    if (days <= 14) return ["water_before", "cooler_spot", "wick", "sitter_visit"];
    return ["sitter_visit", "wick", "cooler_spot"];
  }
  if (days <= 3) return ["water_before", "cooler_spot"];
  if (days <= 7) return ["water_before", "cooler_spot", "pebble_tray", "matting", "reservoir"];
  if (days <= 14)
    return ["water_before", "cooler_spot", "matting", "wick", "reservoir", "sitter_visit"];
  return ["sitter_visit", "reservoir", "wick"];
}

export interface AwayStretch {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/** Runs of consecutive away dates that have not ended before `today`; a run under way starts today. */
export function awayStretches(dates: readonly string[], today: string): AwayStretch[] {
  const now = parseDate(today);
  if (now === undefined) return [];
  const days = [...new Set(dates)]
    .map((d) => parseDate(d))
    .filter((d): d is number => d !== undefined && d >= now)
    .sort((a, b) => a - b);
  const out: AwayStretch[] = [];
  let start: number | undefined;
  let prev = 0;
  for (const d of days) {
    if (start === undefined) start = d;
    else if (d !== prev + 1) {
      out.push({ from: formatDate(start), to: formatDate(prev), days: prev - start + 1 });
      start = d;
    }
    prev = d;
  }
  if (start !== undefined)
    out.push({ from: formatDate(start), to: formatDate(prev), days: prev - start + 1 });
  return out;
}

const STYLES: readonly Style[] = ["keep_moist", "let_top_dry", "let_fully_dry"];

/** The suggestions block for the Holidays tab: the next away stretch, per watering style in use. */
export function awayCareHtml(all: AppData, today: string): string {
  const data = spaceView(all);
  const next = awayStretches(data.settings.prefs.unavailableDates ?? [], today)[0];
  if (next === undefined || data.plants.length === 0) return "";
  const groups = STYLES.map((style) => ({
    style,
    names: data.plants.filter((p) => p.style === style).map((p) => p.name),
  })).filter((g) => g.names.length > 0);
  const body = groups
    .map(
      (
        g,
      ) => `<h4>${tHtml("awaycare.forStyle", { style: t(`style.${g.style}`), names: g.names.join(", ") })}</h4>
      <ul>${awayCare(g.style, next.days)
        .map((s) => `<li>${esc(t(`awaycare.s.${s}`))}</li>`)
        .join("")}</ul>`,
    )
    .join("");
  return `<section id="away-care"><h3>${esc(t("awaycare.heading"))}</h3>
    <p><small>${tHtml("awaycare.stretch", { from: next.from, to: next.to, n: next.days })}</small></p>${body}</section>`;
}
