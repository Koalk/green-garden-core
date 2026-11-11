// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "How much" text (02h): the stop point is the instruction, the amount is secondary and counted in
 * the user's own container. The engine supplies a rounded volume; this module only words it. Precise mode
 * adds an ml figure, labelled "estimate" until the amount rests on the user's own measurement.
 * Shared by the core web UI and the Stories app: every function takes the `Translate` to word it with.
 * PROVISIONAL: container sizes and the bands are guesses until the jug test.
 */
import {
  startMultipliers,
  wateringHint,
  type Calibration,
  type CalibrationLevel,
  type Calibrations,
  type HintInput,
} from "@green-garden/engine";
import type { Translate } from "@green-garden/i18n";
import { startFactsFor, type AppData, type Plant, type Settings } from "@green-garden/storage";

export type Measure = NonNullable<Settings["measure"]>;
export type AmountMode = NonNullable<Settings["amountMode"]>;
export type Wording = NonNullable<Settings["wording"]>;
export type Drainage = NonNullable<Plant["drainage"]>;

export const MEASURES: readonly Measure[] = ["mug", "glass", "jug", "cup", "none"];
export const DRAINAGES: readonly Drainage[] = ["hole", "cachepot", "no_hole", "self_watering"];

export interface AmountPrefs {
  readonly measure: Measure;
  readonly mode: AmountMode;
  readonly wording: Wording;
}

export const DEFAULT_AMOUNT_PREFS: AmountPrefs = {
  measure: "mug",
  mode: "qualitative",
  wording: "uk",
};

/** Settings fields to preferences, with the defaults (02h: mug, qualitative, UK wording). */
export function amountPrefs(
  s: Partial<Pick<Settings, "measure" | "amountMode" | "wording">>,
): AmountPrefs {
  return {
    measure: s.measure ?? DEFAULT_AMOUNT_PREFS.measure,
    mode: s.amountMode ?? DEFAULT_AMOUNT_PREFS.mode,
    wording: s.wording ?? DEFAULT_AMOUNT_PREFS.wording,
  };
}

/** Typical size of each container, in ml. Shown only as the estimate in precise mode. */
const CONTAINER_ML: Record<Exclude<Measure, "none">, number> = {
  mug: 250,
  glass: 200,
  jug: 500,
  cup: 237,
};

/** A hole-less pot gets about this share of the normal amount (02h section 6; guess). */
const NO_HOLE_SHARE = 0.4;
/** More than this many containers is too much to pour by count: say the stop point only. */
const MAX_CONTAINERS = 3;

export interface AmountInput extends HintInput {
  readonly drainage?: Drainage;
}

/** Size of the user's container in ml, for turning "how many mugs I poured" into a measurement. */
export function containerMl(measure: Exclude<Measure, "none">): number {
  return CONTAINER_ML[measure];
}

export interface AmountLines {
  readonly stop: string;
  readonly amount?: string;
  /** Which calibration level the amount came from; absent for the plain estimate. */
  readonly basis?: CalibrationLevel;
  /** One quiet line under the amount: where it came from, or an invitation to measure it once. */
  readonly note?: string;
  /** "A bit more water each time" when the start multipliers' clamp moved part of the interval here. */
  readonly adjustNote?: string;
  readonly warning?: string;
  readonly tip?: string;
}

/** A message in the user's wording: the `.us` variant when asked for and the locale has one. */
function worded(
  tr: Translate,
  key: string,
  wording: Wording,
  params: Record<string, string | number> = {},
): string {
  if (wording === "us") {
    const us = tr(`${key}.us`, params);
    if (us !== `${key}.us`) return us;
  }
  return tr(key, params);
}

const GLYPH: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** `1.5` gives "1½", `0.25` gives "¼", `2` gives "2". */
function quantity(n: number): string {
  const whole = Math.floor(n);
  const frac = GLYPH[n - whole] ?? "";
  return `${whole === 0 ? "" : String(whole)}${frac}`;
}

function capital(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

function amountPhrase(tr: Translate, ml: number, prefs: AmountPrefs): string | undefined {
  if (prefs.measure === "none") return undefined;
  const step = prefs.mode === "precise" ? 0.25 : 0.5;
  const count = Math.round(ml / CONTAINER_ML[prefs.measure] / step) * step;
  if (count > MAX_CONTAINERS) return undefined;
  if (count <= 0) return tr("amount.splash");
  const unit = tr(`amount.unit.${prefs.measure}`, { p: count <= 1 ? "one" : "other" });
  return tr("amount.about", { quantity: quantity(count), unit });
}

export function amountLines(tr: Translate, input: AmountInput, prefs: AmountPrefs): AmountLines {
  const hint = wateringHint(input);
  const drainage = input.drainage ?? "hole";
  if (drainage === "cachepot") return { stop: tr("amount.cachepot") };
  if (drainage === "self_watering") return { stop: tr("amount.selfWatering") };
  const calibrated = hint.calibration !== null;
  // Precise mode adds the ml: the user's own figure once calibrated, else labelled "estimate".
  const withMl = (phrase: string, ml: number): string =>
    prefs.mode === "precise"
      ? tr(calibrated ? "amount.withMl" : "amount.withMl.estimate", {
          amount: phrase,
          ml: Math.round(ml),
        })
      : phrase;
  const provisional = (phrase: string, ml: number): string =>
    tr("amount.provisional", { amount: capital(withMl(phrase, ml)) });
  const basis = hint.calibration === null ? {} : { basis: hint.calibration };
  const adjust = hint.adjust === null ? {} : { adjustNote: tr(`amount.adjust.${hint.adjust}`) };
  const note =
    prefs.measure === "none"
      ? {}
      : {
          note: tr(
            hint.calibration === null ? "amount.note.none" : `amount.note.${hint.calibration}`,
          ),
        };
  if (drainage === "no_hole") {
    const ml = hint.volumeMl === null ? 0 : hint.volumeMl * NO_HOLE_SHARE;
    const phrase = hint.volumeMl === null ? undefined : amountPhrase(tr, ml, prefs);
    return {
      stop: tr("amount.noHole.stop"),
      ...(phrase === undefined ? {} : { amount: provisional(phrase, ml) }),
      warning: tr("amount.noHole.warning"),
      tip: tr("amount.noHole.tip"),
      ...(phrase === undefined ? {} : adjust),
      ...basis,
      ...note,
    };
  }
  const stop = worded(tr, `amount.stop.${hint.style}`, prefs.wording);
  const phrase = hint.volumeMl === null ? undefined : amountPhrase(tr, hint.volumeMl, prefs);
  return {
    stop,
    ...(phrase === undefined || hint.volumeMl === null
      ? {}
      : { amount: provisional(phrase, hint.volumeMl), ...adjust }),
    ...basis,
    ...note,
  };
}

/** The lines of a "How much" answer as one text (the note under it is shown separately). */
export function linesText(a: AmountLines): string {
  return [a.stop, a.amount, a.warning, a.tip].filter((x): x is string => x !== undefined).join(" ");
}

/** The "How much" line as one text. */
export function amountText(
  tr: Translate,
  input: AmountInput,
  prefs: AmountPrefs = DEFAULT_AMOUNT_PREFS,
): string {
  return linesText(amountLines(tr, input, prefs));
}

/**
 * What the amount is worked out from: the pot, how it drains, the calibrations and what the start
 * multipliers' clamp moved into the amount.
 */
export function amountInputFor(data: AppData, p: Plant): AmountInput {
  const facts = startFactsFor(data, p);
  const amountFactor = facts === undefined ? 1 : startMultipliers(facts).amountFactor;
  return {
    style: p.style,
    ...(p.potDiameterCm === undefined ? {} : { potDiameterCm: p.potDiameterCm }),
    ...(p.potHeightCm === undefined ? {} : { potHeightCm: p.potHeightCm }),
    ...(p.drainage === undefined ? {} : { drainage: p.drainage }),
    ...(amountFactor === 1 ? {} : { amountFactor }),
    calibration: calibrationsFor(data, p),
  };
}

/** The quiet line for the plant dialog: about this plant, or the invitation to measure for a new one. */
export function amountNoteFor(
  tr: Translate,
  data: AppData,
  plant: Plant | undefined,
): string | undefined {
  const prefs = amountPrefs(data.settings);
  if (prefs.measure === "none") return undefined;
  return plant === undefined
    ? tr("amount.note.none")
    : amountLines(tr, amountInputFor(data, plant), prefs).note;
}

/** The calibration levels that apply to one plant: its own, its room's and the global one. */
export function calibrationsFor(data: AppData, plant: Plant): Calibrations {
  const room = data.rooms.find((r) => r.id === plant.roomId);
  return {
    ...(plant.calibration === undefined ? {} : { plant: plant.calibration }),
    ...(room?.calibration === undefined ? {} : { room: room.calibration }),
    ...(data.settings.calibration === undefined ? {} : { global: data.settings.calibration }),
  };
}

/**
 * A measurement as a calibration. For one plant it is the amount itself; for a room or everywhere it is a
 * factor against what the app estimated for the test pot, so it also fits the other pots.
 */
export function calibrationFromMeasurement(
  level: CalibrationLevel,
  testPot: HintInput,
  measuredMl: number,
): Calibration | undefined {
  if (!Number.isFinite(measuredMl) || measuredMl <= 0) return undefined;
  if (level === "plant") return { measuredMl };
  const plain = Object.fromEntries(Object.entries(testPot).filter(([k]) => k !== "calibration"));
  const estimate = wateringHint(plain as unknown as HintInput).volumeMl;
  return estimate === null ? undefined : { factor: measuredMl / estimate };
}
