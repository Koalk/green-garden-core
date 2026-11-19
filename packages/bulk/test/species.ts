// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The catalogue draft as the rows the flow reads, built the way scripts/gen-pilot-fixture.mjs builds
 * web-ui's SPECIES (the package must not import web-ui, so the tests read the JSON files themselves).
 */
import { readFileSync, readdirSync } from "node:fs";
import type { BulkSpecies } from "../src/index.ts";

interface Named {
  readonly lang: string;
  readonly name: string;
}

interface Field<T> {
  readonly value: T;
  readonly confidence?: string;
  readonly source?: string;
}

/** The part of a catalogue-draft file this fixture reads. */
interface DraftFile {
  readonly sources: readonly { id: string; publisher?: string; title?: string }[];
  readonly entries: readonly {
    readonly id: string;
    readonly taxon: { readonly scientificName: string };
    readonly names: { readonly common: readonly Named[]; readonly synonyms: readonly string[] };
    readonly tags?: { readonly curated?: readonly string[] };
    readonly lookAlikes?: BulkSpecies["lookAlikes"];
    readonly care: {
      readonly wateringStyle: Field<BulkSpecies["style"]>;
      readonly baseIntervalDays: Field<number | null>;
      readonly restSeasonFactor: Field<number | null>;
      readonly dryToleranceDays: Field<number | null>;
      readonly wetToleranceDays: Field<number | null>;
    };
  }[];
}

const dir = `${import.meta.dirname}/../../../catalogue-draft`;

export const SPECIES: readonly BulkSpecies[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f): BulkSpecies[] => {
    const doc = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as DraftFile;
    const e = doc.entries[0];
    if (e === undefined) return [];
    const c = e.care;
    const src = doc.sources.find(
      (x) => x.id === (c.wateringStyle.source ?? c.baseIntervalDays.source),
    );
    const common = e.names.common;
    const local = common.filter((n) => n.lang !== "en-GB");
    return [
      {
        id: e.id,
        name: common[0]?.name ?? e.id,
        scientificName: e.taxon.scientificName,
        style: c.wateringStyle.value,
        intervalDays: c.baseIntervalDays.value,
        restFactor: c.restSeasonFactor.value,
        dryTolDays: c.dryToleranceDays.value,
        wetTolDays: c.wetToleranceDays.value,
        confidence: `style ${c.wateringStyle.confidence ?? ""}, interval ${c.baseIntervalDays.confidence ?? ""}, tolerances ${c.dryToleranceDays.confidence ?? ""}`,
        careSource:
          src === undefined
            ? "author knowledge, to be verified"
            : (src.publisher ?? src.title ?? "unknown source"),
        commonNames: common.map((n) => n.name),
        ...(local.length === 0
          ? {}
          : { localNames: local.map((n) => ({ lang: n.lang, name: n.name })) }),
        synonyms: e.names.synonyms,
        tags: e.tags?.curated ?? [],
        ...(e.lookAlikes === undefined ? {} : { lookAlikes: e.lookAlikes }),
      },
    ];
  });
