// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FROZEN fixture for the names-per-language matcher tests. Extra non-primary common names per
 * language are the alias lists: what a person copies from a shop label in their country. Do not edit it
 * to follow the real catalogue.
 */
import type { MatcherEntry } from "../src/index.ts";

type Lang = "en-GB" | "es" | "it";

function entry(
  id: string,
  scientificName: string,
  names: Partial<Record<Lang, readonly string[]>>,
  lookAlikes: readonly string[] = [],
  synonyms: readonly string[] = [],
): MatcherEntry {
  const common = (Object.entries(names) as [Lang, readonly string[]][]).flatMap(([lang, list]) =>
    list.map((name, i) => ({ lang, name, primary: i === 0 })),
  );
  return {
    id,
    taxon: { scientificName },
    names: { common, synonyms },
    lookAlikes: lookAlikes.map((species) => ({ species })),
  };
}

export const LANG_FIXTURE: readonly MatcherEntry[] = [
  entry("pelargonium-hortorum", "Pelargonium × hortorum", {
    "en-GB": ["Geranium", "Zonal geranium"],
    es: ["Geranio", "Gitanilla"],
    it: ["Geranio", "Geranio zonale"],
  }),
  entry(
    "geranium-sanguineum",
    "Geranium sanguineum",
    {
      "en-GB": ["Bloody cranesbill", "Cranesbill", "Crane's-bill", "Hardy geranium"],
      es: ["Geranio silvestre", "Geranio sanguíneo"],
      it: ["Geranio sanguigno"],
    },
    ["pelargonium-hortorum"],
  ),
  entry(
    "epipremnum-aureum",
    "Epipremnum aureum",
    { "en-GB": ["Pothos", "Golden pothos"], es: ["Poto", "Potos"], it: ["Pothos"] },
    ["philodendron-hederaceum"],
  ),
  entry(
    "philodendron-hederaceum",
    "Philodendron hederaceum",
    { "en-GB": ["Heartleaf philodendron"], es: ["Filodendro"], it: ["Filodendro"] },
    ["epipremnum-aureum"],
  ),
  // One word that names different plants in two languages (invented for the test: es "yuca" is
  // cassava here, it "yuca" is the garden yucca).
  entry("manihot-esculenta", "Manihot esculenta", {
    "en-GB": ["Cassava"],
    es: ["Yuca", "Mandioca"],
  }),
  entry("yucca-gigantea", "Yucca gigantea", { "en-GB": ["Spineless yucca"], it: ["Yuca"] }),
  // Genus-only input: an entry named exactly "Sansevieria" and one that only lists a species synonym.
  entry("sansevieria", "Sansevieria", { "en-GB": ["Sansevieria"] }),
  entry(
    "dracaena-trifasciata",
    "Dracaena trifasciata",
    { "en-GB": ["Snake plant"] },
    [],
    ["Sansevieria trifasciata"],
  ),
  entry(
    "dracaena-angolensis",
    "Dracaena angolensis",
    { "en-GB": ["Cylindrical snake plant"] },
    [],
    ["Sansevieria cylindrica"],
  ),
];
