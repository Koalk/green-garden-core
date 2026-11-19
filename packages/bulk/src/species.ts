// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The catalogue row as the bulk flow reads it. Web-ui's `SpeciesRow` (pilot-data.ts) and the Stories
 * catalogue rows both fit it; extra fields are ignored.
 */
import type { Plant } from "@green-garden/storage";

export interface BulkSpecies {
  readonly id: string;
  /** Display name (English). */
  readonly name: string;
  readonly scientificName: string;
  readonly style: Plant["style"] | null;
  readonly intervalDays: number | null;
  readonly restFactor: number | null;
  readonly dryTolDays: number | null;
  readonly wetTolDays: number | null;
  readonly confidence: string;
  /** Publisher of the watering-style source, or a note that it is author knowledge. */
  readonly careSource: string;
  readonly commonNames: readonly string[];
  /** Common names in languages other than English (UK), for the name matcher. */
  readonly localNames?: readonly { readonly lang: string; readonly name: string }[];
  readonly synonyms: readonly string[];
  readonly tags: readonly string[];
  /** fields for plants outdoors; absent when the entry has none. */
  readonly outdoor?: OutdoorFill;
  readonly lookAlikes?: readonly {
    readonly name: string;
    readonly species?: string;
    readonly tell: string;
  }[];
}

/** Catalogue facts copied onto a plant at add time so the outdoor engine can read them. */
export interface OutdoorFill {
  readonly rootDepth?: NonNullable<Plant["rootDepth"]>;
  readonly droughtTolerance?: NonNullable<Plant["droughtTolerance"]>;
  readonly dormancy?: NonNullable<Plant["dormancy"]>;
  readonly establishmentSeasons?: NonNullable<Plant["establishmentSeasons"]>;
  readonly establishingIntervalDays?: number;
}

export interface CareFill {
  readonly outdoor?: OutdoorFill;
  readonly style?: Plant["style"];
  readonly intervalDays?: number;
  readonly restFactor?: number;
  readonly dryTolDays?: number;
  readonly wetTolDays?: number;
  /** Shown in the care details heading and stored on the plant. */
  readonly source: string;
}

/** Care values from a catalogue entry. Unknown values are left out, never invented. */
export function careFill(r: BulkSpecies): CareFill {
  return {
    ...(r.style === null ? {} : { style: r.style }),
    ...(r.intervalDays === null ? {} : { intervalDays: r.intervalDays }),
    ...(r.restFactor === null ? {} : { restFactor: r.restFactor }),
    ...(r.dryTolDays === null ? {} : { dryTolDays: r.dryTolDays }),
    ...(r.wetTolDays === null ? {} : { wetTolDays: r.wetTolDays }),
    ...(r.outdoor === undefined || Object.keys(r.outdoor).length === 0
      ? {}
      : { outdoor: r.outdoor }),
    source: `catalogue: ${r.name} (${r.careSource}), not verified: ${r.confidence}`,
  };
}
