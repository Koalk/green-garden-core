// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Direct sun row in add and edit: hours as chips, presets, exact hours.
 * The form carries the hours as text in one hidden field: "" unknown, "none" no sun, else "7-11,15-18".
 */
import { parseSunRanges } from "@green-garden/bulk";
import { directSunHours, type SunPlace, type SunRange } from "@green-garden/engine";
import { esc, t } from "./text.ts";

export const SUN_PRESETS = [
  "morning",
  "midday",
  "afternoon",
  "not_midday",
  "most",
  "none",
  "unsure",
] as const;
export type SunPreset = (typeof SUN_PRESETS)[number];

const PRESET_RANGES: Readonly<Record<Exclude<SunPreset, "unsure">, readonly SunRange[]>> = {
  morning: [{ from: 6, to: 11 }],
  midday: [{ from: 11, to: 15 }],
  afternoon: [{ from: 15, to: 19 }],
  not_midday: [
    { from: 7, to: 11 },
    { from: 15, to: 18 },
  ],
  most: [{ from: 8, to: 18 }],
  none: [],
};

/** The ranges a preset stands for; `unsure` (and anything unknown) is undefined: leave it unset. */
export function presetRanges(id: string): readonly SunRange[] | undefined {
  return id in PRESET_RANGES ? PRESET_RANGES[id as Exclude<SunPreset, "unsure">] : undefined;
}

/** Form text to ranges (the rule lives in `@green-garden/bulk`, which saves the plant). */
export const parseRanges = parseSunRanges;

/** Ranges to form text ([] is "none"). */
export function serialiseRanges(ranges: readonly SunRange[]): string {
  return ranges.length === 0 ? "none" : ranges.map((r) => `${r.from}-${r.to}`).join(",");
}

export function formatRanges(ranges: readonly SunRange[]): string {
  return ranges.map((r) => `${r.from}:00-${r.to}:00`).join(", ");
}

/** The row: chips for the hours, "+ Add hours" (presets and exact hours), "Not sure". */
export function sunRowHtml(value: string, hidden = false): string {
  const ranges = parseRanges(value) ?? [];
  const chips = ranges
    .map((r, i) => {
      const label = formatRanges([r]);
      return `<button type="button" data-action="sun-remove" data-index="${i}" aria-label="${esc(t("sun.remove", { range: label }))}" aria-pressed="true">${esc(label)}</button>`;
    })
    .join(" ");
  const presets = SUN_PRESETS.filter((p) => p !== "unsure")
    .map(
      (p) =>
        `<button type="button" data-action="sun-preset" data-value="${p}">${esc(t(`sun.preset.${p}`))}</button>`,
    )
    .join(" ");
  return `<fieldset class="sun-row"${hidden ? " hidden" : ""}><legend>${esc(t("sun.legend"))}</legend>
    <input type="hidden" name="directSun" value="${esc(value)}">
    <div class="chips">${chips}
      <button type="button" data-action="sun-add-toggle">${esc(t("sun.add"))}</button>
      <button type="button" data-action="sun-preset" data-value="unsure" aria-pressed="${value === ""}">${esc(t("sun.unsure"))}</button></div>
    <div class="sun-add" hidden><div class="chips">${presets}</div>
      <input type="number" aria-label="${esc(t("sun.from"))}" data-sun="from" min="0" max="23" step="1" autocomplete="off">
      <input type="number" aria-label="${esc(t("sun.to"))}" data-sun="to" min="1" max="24" step="1" autocomplete="off">
      <button type="button" data-action="sun-add">${esc(t("sun.save"))}</button></div>
    <small>${esc(t("sun.hint"))}</small></fieldset>`;
}

/** "7:00-11:00 (about 4 hours today)", or "Hardly any" for an empty list. */
export function sunTodayText(ranges: readonly SunRange[], today: string, place: SunPlace): string {
  if (ranges.length === 0) return t("sun.preset.none");
  const n = Math.round(directSunHours(ranges, today, place));
  return `${formatRanges(ranges)} ${t("sun.aboutToday", { n })}`;
}
