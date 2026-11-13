// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The question side of the web UI as pure view models: which plants have
 * something to improve, who gets a "!", what answering writes, and the rows of the plant detail. The
 * ordering, caps and snooze rules are `@green-garden/questions`; nothing here re-decides them. No XP,
 * no pressure: this is the plain surface, and it works the same with gamification off.
 */
import {
  PACING,
  QUESTIONS,
  askLater,
  markAsked,
  neverAsk,
  neverAskPlant,
  nextQuestion,
  rankQuestions,
  type Question,
  type QuestionPlant,
  type QuestionState,
} from "@green-garden/questions";
import {
  SOURCED_FIELDS,
  fieldSource,
  spaceView,
  type AppData,
  type Plant,
  type SourcedField,
} from "@green-garden/storage";
import { fillGroup, groupFilledFrom, groupOf, isSplit, ownAnswer } from "./batch.ts";
import { addDaysIso } from "./dates.ts";

/** The "!" and the voluntary run for a room use this prefix on the target id (Q-ROOMLIGHT lives on rooms). */
export const ROOM_PREFIX = "room:";
/** Shown in place of a plant's room light while the room itself carries the question. */
const ASKED_ON_ROOM = "asked-on-room";

export type Chip = "you" | "assumed" | "learned";

/** Questions this surface can ask: Q-SPECIES needs photo options the web UI has no catalogue data for. */
const SUPPORTED = QUESTIONS.filter((q) => q.id !== "Q-SPECIES").map((q) => q.id);

function questionPlantOf(data: AppData, p: Plant): QuestionPlant {
  const room = data.rooms.find((r) => r.id === p.roomId);
  const logs = p.logs ?? [];
  const count = (o: string) => logs.filter((l) => l.outcome === o).length;
  return {
    id: p.id,
    ...(p.placement === undefined ? {} : { placement: p.placement }),
    ...(p.fieldSources === undefined ? {} : { fieldSources: p.fieldSources }),
    ...(p.drainage === undefined ? {} : { drainage: p.drainage }),
    ...(p.lastWatered === undefined ? {} : { lastWatered: p.lastWatered }),
    ...(p.light === undefined ? {} : { light: p.light }),
    ...(p.potDiameterCm === undefined ? {} : { potDiameterCm: p.potDiameterCm }),
    ...(p.potMaterial === undefined ? {} : { potMaterial: p.potMaterial }),
    ...(p.soilType === undefined ? {} : { soilType: p.soilType }),
    ...(p.plantSize === undefined ? {} : { plantSize: p.plantSize }),
    ...(p.lastRepotted === undefined ? {} : { lastRepotted: p.lastRepotted }),
    ...(p.roomId === undefined ? {} : { roomId: p.roomId }),
    ...(p.roomId === undefined ? {} : { roomLight: room?.light ?? ASKED_ON_ROOM }),
    ...(p.sun === undefined ? {} : { sun: p.sun }),
    ...(p.directSun === undefined ? {} : { directSun: p.directSun }),
    ...(p.groundSoil === undefined ? {} : { groundSoil: p.groundSoil }),
    ...(p.draught === undefined ? {} : { draught: p.draught }),
    ...(p.plantedOn === undefined ? {} : { plantedOn: p.plantedOn }),
    ...(p.mulched === undefined ? {} : { mulched: p.mulched }),
    ...(p.sheltered === undefined ? {} : { sheltered: p.sheltered }),
    waterings: count("done"),
    stillWet: count("still_wet"),
    dryEarly: count("dry_early"),
  };
}

const stateOf = (data: AppData): QuestionState => data.questionState ?? {};
const settingOf = (data: AppData) => data.settings.questions ?? "on";
const hemisphereOf = (data: AppData) => data.settings.hemisphere;

/**
 * Questions the plant could be asked, in order, filtered to what the web UI can ask. Plants added
 * together share a question: only the first member that has it shows it, so a group's shared
 * question counts once in the list and the "!" and answering it fills the others.
 */
function ranked(
  data: AppData,
  p: Plant,
  today: string,
  mode: "list" | "voluntary",
): readonly Question[] {
  const own = rankedRaw(data, p, today, mode);
  if (p.batch === undefined) return own;
  const others = groupOf(data, p).filter((m) => m.id !== p.id);
  const earlier = others.filter((m) => data.plants.indexOf(m) < data.plants.indexOf(p));
  const elsewhere = earlier.map((m) => rankedRaw(data, m, today, mode));
  return own.filter(
    (q) =>
      isSplit(p, q.id) ||
      !elsewhere.some((l, i) => !isSplit(earlier[i] ?? p, q.id) && l.some((x) => x.id === q.id)),
  );
}

function rankedRaw(
  data: AppData,
  p: Plant,
  today: string,
  mode: "list" | "voluntary",
): readonly Question[] {
  const noRooms = spaceView(data).rooms.length === 0;
  return rankQuestions(questionPlantOf(data, p), today, stateOf(data), {
    mode,
    hemisphere: hemisphereOf(data),
  }).filter(
    (q) =>
      SUPPORTED.includes(q.id) &&
      q.id !== "Q-ROOMLIGHT" && // asked once per room, not per plant
      !(q.id === "Q-ROOM" && noRooms),
  );
}

export interface ImproveRow {
  readonly plant: Plant;
  readonly questions: readonly Question[];
  /** Per question: how many other plants added together with this one get the same answer. */
  readonly alsoFor: Readonly<Record<string, number>>;
}

/**
 * "Improve care info": every plant with an open field, the plant with most open things first. It shows
 * everything and ignores pacing, so a user can fill all in one go. Snoozed and never-ask items stay in.
 */
export function improveRows(data: AppData, today: string): ImproveRow[] {
  return spaceView(data)
    .plants.map((plant) => {
      const questions = ranked(data, plant, today, "list");
      return { plant, questions, alsoFor: alsoFor(data, plant, questions, today) };
    })
    .filter((r) => r.questions.length > 0)
    .sort(
      (a, b) => b.questions.length - a.questions.length || a.plant.name.localeCompare(b.plant.name),
    );
}

/** For each question a plant shows: the other plants of its group that would be filled by the answer. */
function alsoFor(
  data: AppData,
  p: Plant,
  questions: readonly Question[],
  today: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (p.batch === undefined) return out;
  const others = groupOf(data, p).filter((m) => m.id !== p.id);
  for (const q of questions) {
    if (isSplit(p, q.id)) continue;
    const n = others.filter(
      (m) => !isSplit(m, q.id) && rankedRaw(data, m, today, "list").some((x) => x.id === q.id),
    ).length;
    if (n > 0) out[q.id] = n;
  }
  return out;
}

/** Plants that show a "!": a voluntary question is ready and the plant was not asked today. */
export function waitingPlants(data: AppData, today: string): string[] {
  if (settingOf(data) === "off") return [];
  return spaceView(data)
    .plants.filter(
      (p) =>
        stateOf(data)[p.id]?.lastAskedOn !== today &&
        ranked(data, p, today, "voluntary").length > 0,
    )
    .map((p) => p.id);
}

/** A room shows a "!" while it has plants but no light set and Q-ROOMLIGHT is not snoozed or silenced. */
export function roomIsWaiting(data: AppData, roomId: string, today: string): boolean {
  if (settingOf(data) === "off") return false;
  const view = spaceView(data);
  const room = view.rooms.find((r) => r.id === roomId);
  if (room === undefined || room.light !== undefined) return false;
  if (!view.plants.some((p) => p.roomId === roomId)) return false;
  const pseudo: QuestionPlant = { id: `${ROOM_PREFIX}${roomId}`, roomId };
  return rankQuestions(pseudo, today, stateOf(data), {
    mode: "voluntary",
    hemisphere: hemisphereOf(data),
  }).some((q) => q.id === "Q-ROOMLIGHT");
}

export interface Ask {
  /** A plant id, or `room:<id>` for Q-ROOMLIGHT. */
  readonly target: string;
  readonly question: Question;
}

/**
 * The next question for a voluntary run, or undefined: stops after 5 answers a sitting, asks each
 * plant once a day, leaves out what the user skipped this sitting. The cap and the one-a-day rule are
 * `nextQuestion`'s; this only picks the plant, the one with the most important question first.
 */
export function nextForSitting(
  data: AppData,
  today: string,
  answeredThisSitting: number,
  skipped: readonly string[] = [],
): Ask | undefined {
  if (settingOf(data) === "off") return undefined;
  const options = {
    mode: "voluntary" as const,
    setting: settingOf(data),
    answeredThisSitting,
    hemisphere: hemisphereOf(data),
  };
  const candidates: Ask[] = [];
  for (const p of spaceView(data).plants) {
    if (skipped.includes(p.id)) continue;
    if (nextQuestion(questionPlantOf(data, p), today, stateOf(data), options) === null) continue;
    const q = ranked(data, p, today, "voluntary")[0];
    if (q !== undefined) candidates.push({ target: p.id, question: q });
  }
  for (const r of spaceView(data).rooms) {
    const target = `${ROOM_PREFIX}${r.id}`;
    if (skipped.includes(target) || !roomIsWaiting(data, r.id, today)) continue;
    if (answeredThisSitting >= PACING.voluntaryPerSitting) continue;
    const q = QUESTIONS.find((x) => x.id === "Q-ROOMLIGHT");
    if (q !== undefined) candidates.push({ target, question: q });
  }
  // Care-impact tier first; the plants keep their list order (stable) inside a tier.
  return candidates.sort((a, b) => a.question.tier.localeCompare(b.question.tier))[0];
}

// ---- answering ---------------------------------------------------------------------------------

const POT_CM: Readonly<Record<string, number>> = { small: 10, medium: 18, large: 28 };
const AGO_DAYS: Readonly<Record<string, number>> = { today: 0, this_week: 7, over_2_weeks: 15 };
const REPOT_DAYS: Readonly<Record<string, number>> = { this_year: 0, last_year: 365, longer: 730 };
/** Days back that "planted this year / last year / more than 2 years ago" stands for (Q-PLANTED). */
const PLANTED_DAYS: Readonly<Record<string, number>> = {
  this_year: 60,
  last_year: 365,
  longer: 900,
};

function withState(data: AppData, state: QuestionState): AppData {
  return { ...data, questionState: state };
}

export function setQuestionsSetting(data: AppData, setting: "on" | "off"): AppData {
  return { ...data, settings: { ...data.settings, questions: setting } };
}

export function snoozeQuestion(
  data: AppData,
  target: string,
  questionId: string,
  today: string,
): AppData {
  return withState(data, askLater(stateOf(data), target, questionId, today));
}

export function neverAskQuestion(data: AppData, target: string, questionId: string): AppData {
  return withState(data, neverAsk(stateOf(data), target, questionId));
}

export function neverAskAboutPlant(data: AppData, plantId: string): AppData {
  return withState(data, neverAskPlant(stateOf(data), plantId));
}

/** Sets a plant field and records that the user said so (a rematch never overwrites it). */
type SunRange = NonNullable<Plant["directSun"]>[number];

/** The presets of Q-SUNHOURS as hour ranges on the local clock; "not_sure" is not one. */
const SUN_PRESETS: Readonly<Record<string, readonly SunRange[]>> = {
  morning: [{ from: 6, to: 11 }],
  midday: [{ from: 11, to: 15 }],
  afternoon: [{ from: 15, to: 19 }],
  morning_afternoon: [
    { from: 7, to: 11 },
    { from: 15, to: 18 },
  ],
  most_of_day: [{ from: 8, to: 18 }],
  none: [],
};

/** The preset whose ranges these are, else the hours as text ("7:00-11:00, 15:00-18:00"). */
function sunText(ranges: readonly SunRange[]): string {
  const same = (a: readonly SunRange[], b: readonly SunRange[]) =>
    JSON.stringify(a) === JSON.stringify(b);
  const preset = Object.entries(SUN_PRESETS).find(([, r]) => same(r, ranges));
  return preset !== undefined
    ? preset[0]
    : ranges.map((r) => `${String(r.from)}:00-${String(r.to)}:00`).join(", ");
}

function setField(p: Plant, patch: Partial<Plant>, field?: SourcedField): Plant {
  const sourced =
    field === undefined ? {} : { fieldSources: { ...p.fieldSources, [field]: "user" } };
  return { ...p, ...patch, ...sourced };
}

function patchFor(
  data: AppData,
  p: Plant,
  questionId: string,
  value: string,
  today: string,
): Plant | undefined {
  const q = QUESTIONS.find((x) => x.id === questionId);
  const known =
    q?.options.includes(value) === true || (questionId === "Q-ROOM" && ownRoom(data, value));
  if (!known) return undefined;
  switch (questionId) {
    case "Q-LIVES":
      return setField(p, { placement: value as NonNullable<Plant["placement"]> }, "placement");
    case "Q-DRAIN":
      return setField(p, { drainage: value as NonNullable<Plant["drainage"]> }, "drainage");
    case "Q-FIRST":
      return value in AGO_DAYS
        ? setField(p, { lastWatered: addDaysIso(today, -(AGO_DAYS[value] ?? 0)) }, "lastWatered")
        : undefined;
    case "Q-LIGHT":
      return value === "not_sure"
        ? undefined
        : setField(p, { light: value as NonNullable<Plant["light"]> }, "light");
    case "Q-POT":
      return value in POT_CM
        ? setField(p, { potDiameterCm: POT_CM[value] ?? 15 }, "potDiameterCm")
        : undefined;
    case "Q-MAT":
      return value === "not_sure"
        ? undefined
        : setField(p, { potMaterial: value as NonNullable<Plant["potMaterial"]> }, "potMaterial");
    case "Q-GROUND":
      return value === "not_sure"
        ? undefined
        : setField(p, { groundSoil: value as NonNullable<Plant["groundSoil"]> });
    case "Q-SUNHOURS":
      return value in SUN_PRESETS
        ? setField(p, { directSun: SUN_PRESETS[value] ?? [] }, "directSun")
        : undefined;
    case "Q-ROOM":
      return value === "none" ? undefined : { ...p, roomId: value };
    case "Q-STILLWET":
      return value === "not_sure"
        ? undefined
        : setField(p, { soilType: value as NonNullable<Plant["soilType"]> }, "soilType");
    case "Q-REPOT":
      return value in REPOT_DAYS
        ? setField(
            p,
            { lastRepotted: addDaysIso(today, -(REPOT_DAYS[value] ?? 0)) },
            "lastRepotted",
          )
        : undefined;
    case "Q-PLANTED":
      return value in PLANTED_DAYS
        ? setField(p, { plantedOn: addDaysIso(today, -(PLANTED_DAYS[value] ?? 0)) }, "plantedOn")
        : undefined;
    case "Q-MULCH":
      return value === "not_sure"
        ? undefined
        : setField(p, { mulched: value === "yes" }, "mulched");
    case "Q-COVER":
      return value === "not_sure"
        ? undefined
        : setField(p, { sheltered: value === "yes" }, "sheltered");
    case "Q-SIZE":
      return setField(p, { plantSize: value as NonNullable<Plant["plantSize"]> }, "plantSize");
    case "Q-DRAUGHT":
      return value === "not_sure"
        ? undefined
        : setField(p, { draught: value as NonNullable<Plant["draught"]> });
    default:
      return undefined;
  }
}

const ownRoom = (data: AppData, id: string) => spaceView(data).rooms.some((r) => r.id === id);

/** Answers that mean "I do not know": the value stays assumed and the question is not asked again. */
const NEVER_ANSWERS: ReadonlySet<string> = new Set([
  "Q-FIRST:no_idea",
  "Q-REPOT:never_or_unknown",
  "Q-ROOM:none",
]);

/**
 * Answers one question. A real answer writes the field with source `user`; "not sure" waits 14 days
 * ("ask me later"); "no idea" style answers silence that question for the plant. `voluntary` records
 * that the plant was asked today (one a day per plant); the improve list does not.
 * Unknown targets, questions and options return the data unchanged.
 */
export function answerQuestion(
  data: AppData,
  target: string,
  questionId: string,
  value: string,
  today: string,
  options: { voluntary?: boolean } = {},
): AppData {
  const note = (d: AppData): AppData =>
    options.voluntary === true ? withState(d, markAsked(stateOf(d), target, today)) : d;
  if (target.startsWith(ROOM_PREFIX)) {
    const roomId = target.slice(ROOM_PREFIX.length);
    if (questionId !== "Q-ROOMLIGHT" || !ownRoom(data, roomId)) return data;
    if (value === "not_sure") return note(snoozeQuestion(data, target, questionId, today));
    if (!["low", "medium", "bright_indirect", "direct"].includes(value)) return data;
    return note({
      ...data,
      rooms: data.rooms.map((r) =>
        r.id === roomId ? { ...r, light: value as NonNullable<typeof r.light> } : r,
      ),
    });
  }
  const p = data.plants.find((x) => x.id === target);
  if (p === undefined) return data;
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (
    q === undefined ||
    !(q.options.includes(value) || (questionId === "Q-ROOM" && ownRoom(data, value)))
  ) {
    return data;
  }
  if (NEVER_ANSWERS.has(`${questionId}:${value}`))
    return note(neverAskQuestion(data, target, questionId));
  const patched = patchFor(data, p, questionId, value, today);
  if (patched === undefined) {
    return value === "not_sure" ? note(snoozeQuestion(data, target, questionId, today)) : data;
  }
  // The answer is this plant's own from now on; plants added together with it take it unless theirs is the user's own.
  const mine = ownAnswer(patched, questionId);
  const plants = fillGroup(
    data.plants.map((x) => (x.id === target ? mine : x)),
    p,
    patched,
    questionId,
  );
  return note({ ...data, plants });
}

// ---- plant detail --------------------------------------------------------------------------------

export function sourceChip(plant: Pick<Plant, "fieldSources">, field: string): Chip {
  if (!(SOURCED_FIELDS as readonly string[]).includes(field)) return "you";
  const s = fieldSource(plant, field as SourcedField);
  return s === "user" ? "you" : s === "learned" ? "learned" : "assumed";
}

export interface DetailRow {
  readonly question: Question;
  /** The stored value as an option key where it is one, else the raw value (a date, a number); undefined = not set. */
  readonly value: string | undefined;
  readonly chip: Chip;
  /** How many other plants added together with this one took this plant's answer. */
  readonly sharedWith: number;
}

/** The field each editable row shows. */
function rowValue(p: Plant, id: string): { value: string | undefined; field: string } {
  switch (id) {
    case "Q-LIVES":
      return { value: p.placement, field: "placement" };
    case "Q-DRAIN":
      return { value: p.drainage, field: "drainage" };
    case "Q-FIRST":
      return { value: p.lastWatered, field: "lastWatered" };
    case "Q-LIGHT":
      return { value: p.light, field: "light" };
    case "Q-POT":
      return {
        value: p.potDiameterCm === undefined ? undefined : String(p.potDiameterCm),
        field: "potDiameterCm",
      };
    case "Q-MAT":
      return { value: p.potMaterial, field: "potMaterial" };
    case "Q-GROUND":
      return { value: p.groundSoil, field: "groundSoil" };
    case "Q-SUNHOURS":
      return {
        value: p.directSun === undefined ? undefined : sunText(p.directSun),
        field: "directSun",
      };
    case "Q-ROOM":
      return { value: p.roomId, field: "roomId" };
    case "Q-STILLWET":
      return { value: p.soilType, field: "soilType" };
    case "Q-REPOT":
      return { value: p.lastRepotted, field: "lastRepotted" };
    case "Q-PLANTED":
      return { value: p.plantedOn, field: "plantedOn" };
    case "Q-MULCH":
      return { value: p.mulched === undefined ? undefined : String(p.mulched), field: "mulched" };
    case "Q-COVER":
      return {
        value: p.sheltered === undefined ? undefined : String(p.sheltered),
        field: "sheltered",
      };
    case "Q-SIZE":
      return { value: p.plantSize, field: "plantSize" };
    default:
      return { value: p.draught, field: "draught" };
  }
}

const PLANT_ROWS = [
  "Q-LIVES",
  "Q-DRAIN",
  "Q-FIRST",
  "Q-LIGHT",
  "Q-POT",
  "Q-MAT",
  "Q-GROUND",
  "Q-SUNHOURS",
  "Q-PLANTED",
  "Q-MULCH",
  "Q-COVER",
  "Q-ROOM",
  "Q-STILLWET",
  "Q-REPOT",
  "Q-SIZE",
  "Q-DRAUGHT",
];

/**
 * Every question field of one plant as a row: the value, where it came from (the source chip) and,
 * through the question, the options to change it with. Pot rows go for a plant in the ground and the
 * ground row appears only there; the room row needs a room to pick.
 */
export function detailRows(data: AppData, plantId: string): DetailRow[] {
  const p = data.plants.find((x) => x.id === plantId);
  if (p === undefined) return [];
  const inGround = p.placement === "ground";
  const rooms = spaceView(data).rooms.length > 0;
  const outdoors = p.placement === "outdoor_pot";
  const skip = inGround
    ? ["Q-DRAIN", "Q-POT", "Q-MAT", "Q-REPOT", "Q-DRAUGHT", "Q-STILLWET"]
    : ["Q-GROUND", "Q-PLANTED", "Q-MULCH", ...(outdoors ? [] : ["Q-COVER", "Q-SUNHOURS"])];
  return PLANT_ROWS.filter((id) => !skip.includes(id) && (id !== "Q-ROOM" || rooms)).flatMap(
    (id) => {
      const question = QUESTIONS.find((q) => q.id === id);
      if (question === undefined) return [];
      const { value, field } = rowValue(p, id);
      return [
        {
          question,
          value,
          chip: value === undefined ? "assumed" : sourceChip(p, field),
          sharedWith: groupFilledFrom(data, plantId, id).length,
        },
      ];
    },
  );
}

/** The question a tapped "!" opens: the plant's (or room's) first voluntary question. */
export function questionFor(data: AppData, target: string, today: string): Question | undefined {
  if (target.startsWith(ROOM_PREFIX)) {
    return roomIsWaiting(data, target.slice(ROOM_PREFIX.length), today)
      ? QUESTIONS.find((q) => q.id === "Q-ROOMLIGHT")
      : undefined;
  }
  const p = data.plants.find((x) => x.id === target);
  return p === undefined ? undefined : ranked(data, p, today, "voluntary")[0];
}

/** A voluntary sitting resets after 30 minutes without an answer. */
export const SITTING_MS = 30 * 60 * 1000;

export function answersThisSitting(count: number, lastAnswerAt: number, now: number): number {
  return now - lastAnswerAt > SITTING_MS ? 0 : count;
}

/** The options of a question as value and label; Q-ROOM offers the space's own rooms. */
export function optionsOf(
  data: AppData,
  q: Question,
  text: Readonly<Record<string, string>>,
  noneLabel: string,
): { value: string; label: string }[] {
  if (q.id === "Q-ROOM") {
    return [
      ...spaceView(data).rooms.map((r) => ({ value: r.id, label: r.name })),
      { value: "none", label: noneLabel },
    ];
  }
  return q.options.map((value) => ({ value, label: text[value] ?? value }));
}
