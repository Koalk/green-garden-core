// SPDX-License-Identifier: AGPL-3.0-only

import bank from "./questions.json" with { type: "json" };

export type Tier = "A" | "B" | "C";
export type Locale = "en-GB" | "es" | "it";
export type Placement = "indoor" | "outdoor_pot" | "ground";
export type FieldSource = "catalogue" | "default" | "user" | "learned";

export interface QuestionText {
  readonly question: string;
  /** Option value to label. */
  readonly options: Readonly<Record<string, string>>;
}

/** One entry of the question bank. Plain wording only; the Stories flavour is a text key. */
export interface Question {
  readonly id: string;
  /** Care-impact tier: A ranks 1 to 4, B ranks 5 to 7, C the rest. */
  readonly tier: Tier;
  /** Care-impact weight for the seeded shuffle: heavier tends to come earlier inside a tier. */
  readonly weight: number;
  /** Name of the relevance rule in this module. */
  readonly when: string;
  /** The plant (or room) fields an answer sets. */
  readonly updates: readonly string[];
  /** False when the answer feeds no engine input (Q-DRAUGHT only widens the uncertainty note). */
  readonly engineInput?: boolean;
  /** Always last inside its tier. */
  readonly last?: boolean;
  /** Text key the Stories flavour layer looks up; core never reads it. */
  readonly storiesKey: string;
  readonly options: readonly string[];
  readonly text: Readonly<Record<Locale, QuestionText>>;
}

export const QUESTIONS: readonly Question[] = bank as readonly Question[];

/** Wording every question shares ("not sure" is an option of the questions that need it). */
export const COMMON_TEXT: Readonly<
  Record<Locale, { askLater: string; neverAsk: string; neverAskPlant: string }>
> = {
  "en-GB": {
    askLater: "Ask me later",
    neverAsk: "Never ask this",
    neverAskPlant: "Never ask about this plant",
  },
  es: {
    askLater: "Pregúntame más tarde",
    neverAsk: "No preguntar esto nunca",
    neverAskPlant: "No preguntar nada sobre esta planta",
  },
  it: {
    askLater: "Chiedimelo più tardi",
    neverAsk: "Non chiederlo mai",
    neverAskPlant: "Non chiedere nulla su questa pianta",
  },
};

/** What the question rules read from a plant. Structural, so the package needs no storage import. */
export interface QuestionPlant {
  readonly id: string;
  /** Date the plant was added (`YYYY-MM-DD`); absent means not a new plant. */
  readonly addedOn?: string;
  readonly placement?: Placement;
  /** Where the catalogue says this species usually lives. */
  readonly typicalPlacement?: Placement;
  /** The plant came from a "choose" match or a rematch the user has not confirmed. */
  readonly speciesToConfirm?: boolean;
  readonly fieldSources?: Readonly<Record<string, FieldSource | undefined>>;
  readonly drainage?: string;
  readonly lastWatered?: string;
  readonly light?: string;
  readonly potDiameterCm?: number;
  readonly potMaterial?: string;
  readonly soilType?: string;
  readonly plantSize?: string;
  readonly lastRepotted?: string;
  readonly roomId?: string;
  /** The room's light, when the plant has a room. */
  readonly roomLight?: string;
  readonly sun?: string;
  /** When the spot gets direct sun, as hour ranges (Q-SUNHOURS); [] means none. */
  readonly directSun?: readonly { readonly from: number; readonly to: number }[];
  readonly groundSoil?: string;
  /** In the ground: the planting date (`YYYY-MM-DD`), when known (Q-PLANTED). */
  readonly plantedOn?: string;
  /** In the ground: mulch on top (Q-MULCH). */
  readonly mulched?: boolean;
  /** Under a roof, tree or overhang, so rain does not reach it (Q-COVER). */
  readonly sheltered?: boolean;
  readonly draught?: string;
  /** Logged waterings (done) so far. */
  readonly waterings?: number;
  /** "Still wet" logs so far. */
  readonly stillWet?: number;
  /** "Dry early" logs so far. */
  readonly dryEarly?: number;
}

/** Per-plant question state, keyed by plant id in {@link QuestionState}. */
export interface PlantQuestionState {
  /** The day a question was last put to this plant (the one-a-day cap). */
  readonly lastAskedOn?: string;
  /** Per question: not before this date. */
  readonly snoozedUntil?: Readonly<Record<string, string>>;
  /** Per question: how often "ask me later" was chosen; the third moves it to the improve list only. */
  readonly snoozes?: Readonly<Record<string, number>>;
  readonly never?: Readonly<Record<string, true>>;
  readonly neverPlant?: boolean;
}
export type QuestionState = Readonly<Record<string, PlantQuestionState>>;

/**
 * `push`: the app puts a question forward by itself (daily caps, busy day, first week).
 * `voluntary`: the user tapped the "!" and is answering several in a row (5 a sitting).
 * `list`: the improve list, which shows everything that could be improved and ignores pacing.
 */
export type Mode = "push" | "voluntary" | "list";

export interface Options {
  readonly mode?: Mode;
  /** "off" switches the "!" and the pushes off; the list still works. */
  readonly setting?: "on" | "off";
  /** Plants with a watering due today, across the space. */
  readonly dueToday?: number;
  /** Questions already pushed today, across all plants. */
  readonly pushedToday?: number;
  /** Answers given in the current voluntary sitting. */
  readonly answeredThisSitting?: number;
  readonly hemisphere?: "north" | "south";
}

/** Pacing numbers. */
export const PACING = {
  /** Plants due today at or above which no question is pushed. */
  busyDayPlants: 4,
  pushedPerDay: 2,
  /** A new plant gets tier A only, one question a day in total, for this many days. */
  firstWeekDays: 7,
  voluntaryPerSitting: 5,
  snoozeDays: 14,
  /** The third "ask me later" moves the question to the improve list only. */
  snoozesBeforeListOnly: 3,
  /** Days after which "how big is it now?" is worth asking. */
  sizeAfterDays: 28,
} as const;

type Level = "none" | "listed" | "ready" | "now";
type Rule = (p: QuestionPlant, today: string, o: Options) => Level;

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const addDays = (d: string, n: number) =>
  new Date((dayNumber(d) + n) * DAY_MS).toISOString().slice(0, 10);

/** The user has set the field themselves (a missing source reads as `user`, as in storage). */
function known(p: QuestionPlant, field: string, value: unknown): boolean {
  return value !== undefined && (p.fieldSources?.[field] ?? "user") === "user";
}

/** Where the plant lives: indoors unless set, or unless the species only grows in the ground. */
const placementOf = (p: QuestionPlant): Placement =>
  p.placement ?? (p.typicalPlacement === "ground" ? "ground" : "indoor");
const inGround = (p: QuestionPlant) => placementOf(p) === "ground";
const watered = (p: QuestionPlant) => (p.waterings ?? 0) >= 1;

function isSpring(today: string, hemisphere: "north" | "south"): boolean {
  const month = Number(today.slice(5, 7));
  return hemisphere === "south" ? month >= 9 && month <= 11 : month >= 3 && month <= 5;
}

/** The relevance rules of the bank. `listed` = the field is open; `ready` = a push may ask now; `now` = an event makes it timely. */
const RULES: Readonly<Record<string, Rule>> = {
  species: (p) => (p.speciesToConfirm ? "now" : "none"),
  lives: (p) => {
    if (p.placement === undefined) return p.typicalPlacement ? "listed" : "none";
    return p.typicalPlacement && p.typicalPlacement !== p.placement ? "ready" : "none";
  },
  drain: (p) => {
    if (inGround(p) || known(p, "drainage", p.drainage)) return "none";
    return watered(p) ? "ready" : "now";
  },
  first: (p) => (known(p, "lastWatered", p.lastWatered) ? "none" : "ready"),
  light: (p) => {
    if (p.roomId !== undefined) return "none"; // the room carries the light: Q-ROOMLIGHT
    if (known(p, "light", p.light)) return "none";
    if ((p.stillWet ?? 0) >= 1 || (p.dryEarly ?? 0) >= 2) return "now";
    return "listed";
  },
  roomlight: (p) => (p.roomId !== undefined && p.roomLight === undefined ? "ready" : "none"),
  pot: (p) => {
    if (inGround(p) || known(p, "potDiameterCm", p.potDiameterCm)) return "none";
    return watered(p) ? "ready" : "listed";
  },
  mat: (p) => {
    if (inGround(p) || known(p, "potMaterial", p.potMaterial)) return "none";
    if ((p.dryEarly ?? 0) >= 1) return "now";
    return watered(p) ? "ready" : "listed";
  },
  // for a plant in the ground the planting date and the soil decide the watering
  // mode, so they come first inside their tier ("now").
  ground: (p) => {
    if (!inGround(p)) return "none";
    return known(p, "groundSoil", p.groundSoil) ? "none" : "now";
  },
  // outdoors only; the hours back up and override the sun class. Indoors the question
  // belongs to the room (a follow-up row).
  sunhours: (p) =>
    placementOf(p) !== "indoor" && !known(p, "directSun", p.directSun) ? "ready" : "none",
  planted: (p) => (inGround(p) && !known(p, "plantedOn", p.plantedOn) ? "now" : "none"),
  mulch: (p) => (inGround(p) && !known(p, "mulched", p.mulched) ? "ready" : "none"),
  cover: (p) =>
    placementOf(p) !== "indoor" && !known(p, "sheltered", p.sheltered) ? "ready" : "none",
  room: (p) => {
    if (p.roomId !== undefined) return "none";
    return watered(p) ? "ready" : "listed";
  },
  stillwet: (p) => {
    if (known(p, "soilType", p.soilType)) return "none";
    return (p.stillWet ?? 0) >= 1 ? "now" : "listed";
  },
  repot: (p, today, o) => {
    if (inGround(p) || known(p, "lastRepotted", p.lastRepotted)) return "none";
    return isSpring(today, o.hemisphere ?? "north") ? "now" : "listed";
  },
  size: (p, today) => {
    if (known(p, "plantSize", p.plantSize)) return "none";
    const old =
      p.addedOn === undefined || dayNumber(today) - dayNumber(p.addedOn) >= PACING.sizeAfterDays;
    return old ? "ready" : "listed";
  },
  draught: (p) => {
    if (placementOf(p) !== "indoor" || p.draught !== undefined) return "none";
    return watered(p) ? "ready" : "listed";
  },
};

/** FNV-1a over the plant and question ids: the same on every device and after export/import. */
function seedFor(plantId: string, questionId: string): number {
  let h = 0x811c9dc5;
  const text = `${plantId}\u0000${questionId}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Weighted shuffle key (the exponential race): sorting ascending puts heavier questions earlier more
 * often, but not always, and the same plant and question always get the same key.
 */
function shuffleKey(plantId: string, q: Question): number {
  const u = (seedFor(plantId, q.id) + 0.5) / 4_294_967_296;
  return -Math.log(u) / q.weight;
}

const LEVEL_OK: Readonly<Record<Mode, readonly Level[]>> = {
  list: ["listed", "ready", "now"],
  voluntary: ["ready", "now"],
  push: ["ready", "now"],
};

/**
 * Every question that could be asked about the plant, in the order to ask them. Care-impact tier first;
 * inside a tier, questions an event makes timely come first, then a shuffle seeded per plant, with
 * `last` questions at the end of their tier. Snoozed and never-ask questions are left out, except in
 * `list` mode (the improve list shows everything). Pure: same input, same order.
 */
export function rankQuestions(
  plant: QuestionPlant,
  today: string,
  state: QuestionState,
  options: Options = {},
): Question[] {
  const mode = options.mode ?? "push";
  const mine = state[plant.id];
  const out: { q: Question; now: boolean; key: number }[] = [];
  for (const q of QUESTIONS) {
    const level = RULES[q.when]?.(plant, today, options) ?? "none";
    if (!LEVEL_OK[mode].includes(level)) continue;
    if (mode !== "list") {
      if (mine?.neverPlant || mine?.never?.[q.id]) continue;
      const until = mine?.snoozedUntil?.[q.id];
      if (until !== undefined && until > today) continue;
      if ((mine?.snoozes?.[q.id] ?? 0) >= PACING.snoozesBeforeListOnly) continue;
    }
    out.push({ q, now: level === "now", key: shuffleKey(plant.id, q) });
  }
  out.sort(
    (a, b) =>
      a.q.tier.localeCompare(b.q.tier) ||
      Number(a.q.last ?? false) - Number(b.q.last ?? false) ||
      Number(b.now) - Number(a.now) ||
      a.key - b.key,
  );
  return out.map((x) => x.q);
}

/**
 * The question to put to this plant now, or null. Pushes obey the caps of the pacing numbers: nothing
 * on a busy day, 2 a day in total, 1 a day per plant, tier A only and 1 a day in total during a
 * plant's first week. A voluntary run ignores the daily caps but stops at 5 answers a sitting.
 */
export function nextQuestion(
  plant: QuestionPlant,
  today: string,
  state: QuestionState,
  options: Options = {},
): Question | null {
  const mode = options.mode ?? "push";
  if (mode === "list" || options.setting === "off") return null;
  if (state[plant.id]?.lastAskedOn === today) return null;
  let tierA = false;
  if (mode === "voluntary") {
    if ((options.answeredThisSitting ?? 0) >= PACING.voluntaryPerSitting) return null;
  } else {
    if ((options.dueToday ?? 0) >= PACING.busyDayPlants) return null;
    const pushed = options.pushedToday ?? 0;
    if (pushed >= PACING.pushedPerDay) return null;
    if (
      plant.addedOn !== undefined &&
      dayNumber(today) - dayNumber(plant.addedOn) < PACING.firstWeekDays
    ) {
      if (pushed >= 1) return null;
      tierA = true;
    }
  }
  return rankQuestions(plant, today, state, options).find((q) => !tierA || q.tier === "A") ?? null;
}

/** Whether the plant shows a "!": a question is ready, ignoring the daily caps. */
export function hasWaitingQuestion(
  plant: QuestionPlant,
  today: string,
  state: QuestionState,
  options: Options = {},
): boolean {
  if (options.setting === "off") return false;
  return rankQuestions(plant, today, state, { ...options, mode: "voluntary" }).length > 0;
}

function withPlant(
  state: QuestionState,
  plantId: string,
  change: PlantQuestionState,
): QuestionState {
  return { ...state, [plantId]: { ...state[plantId], ...change } };
}

/** Record that a question was put to the plant today (the one-a-day cap). */
export function markAsked(state: QuestionState, plantId: string, today: string): QuestionState {
  return withPlant(state, plantId, { lastAskedOn: today });
}

/** "Ask me later": the question waits 14 days; the third time it only stays in the improve list. */
export function askLater(
  state: QuestionState,
  plantId: string,
  questionId: string,
  today: string,
): QuestionState {
  const mine = state[plantId];
  return withPlant(state, plantId, {
    snoozedUntil: { ...mine?.snoozedUntil, [questionId]: addDays(today, PACING.snoozeDays) },
    snoozes: { ...mine?.snoozes, [questionId]: (mine?.snoozes?.[questionId] ?? 0) + 1 },
  });
}

/** "Never ask this" for one question on one plant; the value stays editable in the list. */
export function neverAsk(state: QuestionState, plantId: string, questionId: string): QuestionState {
  return withPlant(state, plantId, { never: { ...state[plantId]?.never, [questionId]: true } });
}

/** "Never ask about this plant". */
export function neverAskPlant(state: QuestionState, plantId: string): QuestionState {
  return withPlant(state, plantId, { neverPlant: true });
}
