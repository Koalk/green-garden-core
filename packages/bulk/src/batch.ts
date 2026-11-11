// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plants added together from one counted line ("3x aloe vera") share their answers
 *: answering a question for one fills the same field for the others whose value is not the
 * user's own, and "They differ" takes the fill back and keeps that field per plant. The group is
 * `Plant.batch` in storage (optional and additive: the export stays at version 8). Pure functions over
 * `AppData`; `answerQuestion` and the Improve list in `improve.ts` call in here.
 */
import {
  SOURCED_FIELDS,
  fieldSource,
  type AppData,
  type Plant,
  type PlantBatch,
  type SourcedField,
} from "@green-garden/storage";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Before = NonNullable<PlantBatch["filled"]>[string]["before"];

const isSourced = (k: string): k is SourcedField =>
  (SOURCED_FIELDS as readonly string[]).includes(k);
const KEEP = new Set(["id", "spaceId", "fieldSources", "batch"]);

/** The next unused group id ("b1", "b2", ...) among the plants of this data. */
export function nextBatchId(data: AppData): string {
  let max = 0;
  for (const p of data.plants) {
    const n = /^b(\d+)$/.exec(p.batch?.id ?? "")?.[1];
    if (n !== undefined) max = Math.max(max, Number(n));
  }
  return `b${String(max + 1)}`;
}

/** The plants added together with this one (itself included), in list order; just itself if alone. */
export function groupOf(data: AppData, p: Plant): Plant[] {
  const id = p.batch?.id;
  if (id === undefined) return [p];
  return data.plants.filter((x) => x.spaceId === p.spaceId && x.batch?.id === id);
}

export const isSplit = (p: Plant, questionId: string): boolean =>
  p.batch?.split?.includes(questionId) === true;

const omit = <T extends object>(o: T, key: string): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Partial<T>;

const withBatch = (p: Plant, batch: PlantBatch): Plant => ({ ...omit(p, "batch"), batch }) as Plant;

/** A batch with one question's fill record removed. */
function dropFilled(batch: PlantBatch, questionId: string): PlantBatch {
  const filled = omit(batch.filled ?? {}, questionId);
  const rest = omit(batch, "filled") as PlantBatch;
  return Object.keys(filled).length === 0
    ? rest
    : { ...rest, filled: filled as NonNullable<PlantBatch["filled"]> };
}

/**
 * The plant after its owner answered for itself: it keeps its own value from now on, so a later answer
 * for another member no longer counts it as a fill.
 */
export function ownAnswer(p: Plant, questionId: string): Plant {
  return p.batch?.filled?.[questionId] === undefined
    ? p
    : withBatch(p, dropFilled(p.batch, questionId));
}

/**
 * Copies what an answer changed on `before` (now `after`) to the other members of the group. A member
 * takes it unless the question is split, or the field holds the user's own value (a value that was
 * itself filled from the group is not the user's own). Fills carry source `user` and remember what they
 * replaced, so "They differ" can put it back. Returns the plants with the fills applied.
 */
export function fillGroup(
  plants: readonly Plant[],
  before: Plant,
  after: Plant,
  questionId: string,
): Plant[] {
  const group = before.batch;
  if (group === undefined || isSplit(after, questionId)) return [...plants];
  const fields = Object.keys(after).filter(
    (k) =>
      !KEEP.has(k) &&
      JSON.stringify((after as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((before as unknown as Record<string, unknown>)[k]),
  );
  const sources = Object.keys(after.fieldSources ?? {}).filter(
    (k) => after.fieldSources?.[k as SourcedField] !== before.fieldSources?.[k as SourcedField],
  );
  if (fields.length === 0) return [...plants];
  return plants.map((m) => {
    if (m.id === before.id || m.spaceId !== before.spaceId || m.batch?.id !== before.batch?.id) {
      return m;
    }
    const mine = m as unknown as Record<string, unknown>;
    const wasFilled = m.batch?.filled?.[questionId];
    const free = fields.every((k) =>
      isSourced(k)
        ? wasFilled !== undefined || fieldSource(m, k) !== "user"
        : wasFilled !== undefined || mine[k] === undefined,
    );
    if (isSplit(m, questionId) || !free) return m;
    const was: Before = wasFilled?.before ?? {
      fields: Object.fromEntries(
        fields.map((k) => [k, (mine[k] as string | number | undefined) ?? null]),
      ),
      sources: Object.fromEntries(
        sources.map((k) => [k, m.fieldSources?.[k as SourcedField] ?? null]),
      ),
    };
    const next: Mutable<Plant> = { ...m };
    for (const k of fields) {
      (next as unknown as Record<string, unknown>)[k] = (
        after as unknown as Record<string, unknown>
      )[k];
    }
    if (sources.length > 0) {
      next.fieldSources = {
        ...m.fieldSources,
        ...Object.fromEntries(sources.map((k) => [k, "user"])),
      };
    }
    const batch: PlantBatch = m.batch ?? group;
    return {
      ...next,
      batch: {
        ...batch,
        filled: { ...batch.filled, [questionId]: { from: before.id, before: was } },
      },
    };
  });
}

/** The members whose value for this question came from `plantId`'s answer. */
export function groupFilledFrom(data: AppData, plantId: string, questionId: string): string[] {
  return data.plants
    .filter((m) => m.batch?.filled?.[questionId]?.from === plantId)
    .map((m) => m.id);
}

/**
 * "They differ": the members filled from this plant's answer go back to what they had, and the
 * question is split for the whole group, so it is asked per plant from now on. A member that answered
 * for itself keeps its value. Nothing changes for a plant that is not in a group.
 */
export function theyDiffer(data: AppData, plantId: string, questionId: string): AppData {
  const p = data.plants.find((x) => x.id === plantId);
  if (p?.batch === undefined) return data;
  const group = p.batch.id;
  return {
    ...data,
    plants: data.plants.map((m) => {
      if (m.spaceId !== p.spaceId || m.batch?.id !== group) return m;
      let out: Plant = m;
      const fill = m.batch.filled?.[questionId];
      if (fill?.from === plantId) {
        const fields = Object.entries({ ...m, ...fill.before.fields }).filter(
          ([k]) => fill.before.fields[k] !== null,
        );
        const sources = Object.entries({ ...m.fieldSources, ...fill.before.sources }).filter(
          ([k]) => fill.before.sources[k] !== null,
        );
        out = { ...Object.fromEntries(fields), fieldSources: Object.fromEntries(sources) } as Plant;
      }
      const batch = out.batch ?? m.batch;
      const cleaned = fill?.from === plantId ? dropFilled(batch, questionId) : batch;
      return withBatch(out, {
        ...cleaned,
        split: [...new Set([...(cleaned.split ?? []), questionId])],
      });
    }),
  };
}
