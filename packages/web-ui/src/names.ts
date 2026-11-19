// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Names for the "Randomise name" button. First the species' own `nameIdeas`, then wordplay built
 * from its names and traits, then large general lists. Plain, family-friendly wording only.
 */
import type { SpeciesRow } from "./pilot-data.ts";

// prettier-ignore
export const ADJECTIVES: readonly string[] = [
  "Sunny", "Leafy", "Mellow", "Bouncy", "Cheery", "Dozy", "Fuzzy", "Jolly", "Plucky", "Rosy",
  "Sprightly", "Zesty", "Breezy", "Cosy", "Dapper", "Gentle", "Giddy", "Happy", "Humble", "Lively",
  "Merry", "Nimble", "Peppy", "Perky", "Quirky", "Shiny", "Snug", "Spry", "Sweet", "Toasty",
  "Wiggly", "Witty", "Bubbly", "Chirpy", "Dandy", "Frisky", "Glowing", "Hearty", "Lucky", "Wobbly",
  "Chipper", "Dreamy", "Fluffy", "Graceful", "Mighty", "Rustic", "Silly", "Tiny",
];

// prettier-ignore
export const NOUNS: readonly string[] = [
  "Biscuit", "Pickle", "Noodle", "Pebble", "Muffin", "Waffle", "Button", "Bean", "Cobbler", "Dumpling",
  "Sprout", "Truffle", "Acorn", "Bagel", "Berry", "Bubble", "Cupcake", "Doodle", "Fiddle", "Ginger",
  "Honey", "Jelly", "Kettle", "Lemon", "Mango", "Nugget", "Olive", "Pancake", "Pretzel", "Pudding",
  "Radish", "Sparrow", "Sundae", "Teacup", "Thistle", "Toffee", "Turnip", "Whistle", "Willow", "Yoyo",
  "Biscotti", "Clover", "Crumpet", "Fennel", "Gumdrop", "Marble", "Nutmeg", "Poppy",
];

// prettier-ignore
const TITLES = ["Sir", "Lady", "Captain", "Professor", "Doctor", "Little", "Big", "Baby", "Uncle", "Auntie", "Count", "Duke"];

/** Wordplay on how the plant grows, from the catalogue's `habit` and `tags`. */
const TRAITS: Readonly<Record<string, readonly string[]>> = {
  trailing: ["Dangles", "Trailblazer", "Rapunzel", "Swinger", "Dangly", "Vine Diesel"],
  climbing: ["Climber", "Ladder", "Skyward", "Vine Diesel", "Highflyer"],
  upright: ["Tall Order", "Lofty", "Stretch", "Skyscraper"],
  rosette: ["Spike", "Pointy", "Starburst", "Porcupine"],
  bushy: ["Fluffy", "Bushy Tail", "Shaggy", "Pom-pom"],
  low_light: ["Shady", "Dusk", "Moonbeam"],
  beginner_friendly: ["Rookie", "First Mate", "Easy Rider"],
};

/** Words that say nothing about the species, so wordplay skips them. */
const GENERIC = new Set(["plant", "plants", "tree", "palm", "vine"]);

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** "Monstera" -> "Monty", "Spider" -> "Spidy": four letters and a y. */
function stem(word: string): string {
  const w = word.replace(/[^\p{L}]/gu, "");
  return w.length < 3 ? "" : `${cap(w.slice(0, 4))}y`;
}

/** Name candidates built from a species' own words and traits, in no particular order. */
function ruleNames(r: SpeciesRow): string[] {
  const words = [
    ...r.commonNames.flatMap((n) => n.split(/\s+/)),
    ...r.scientificName.split(/\s+/),
  ].filter((w) => w.length >= 4 && !GENERIC.has(w.toLowerCase()));
  const stems = [...new Set(words.map(stem).filter((s) => s !== ""))];
  const traits = [...(r.habit === null ? [] : [r.habit]), ...r.tags].flatMap(
    (t) => TRAITS[t] ?? [],
  );
  const out: string[] = [];
  for (const s of stems) {
    for (const t of TITLES) out.push(`${t} ${s}`);
    for (const t of traits) out.push(`${t} ${s}`);
    out.push(s);
  }
  for (const w of words) for (const t of traits) out.push(`${t} ${cap(w)}`);
  return out;
}

/**
 * A name that is not in `used` (lower case). `random` returns [0, 1). The caller adds the result to
 * `used`, so one session never repeats a name.
 */
export function nextName(
  species: SpeciesRow | undefined,
  used: ReadonlySet<string>,
  random: () => number,
): string {
  const pick = (list: readonly string[]): string | undefined => {
    const free = list.filter((n) => !used.has(n.toLowerCase()));
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  };
  if (species !== undefined) {
    const idea = pick(species.nameIdeas ?? []);
    if (idea !== undefined) return idea;
    const rule = pick([...new Set(ruleNames(species))]);
    if (rule !== undefined) return rule;
  }
  const at = (list: readonly string[]): string =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))] ?? "Plant";
  for (let i = 0; i < 200; i += 1) {
    const n = `${at(ADJECTIVES)} ${at(NOUNS)}`;
    if (!used.has(n.toLowerCase())) return n;
  }
  const base = `${at(ADJECTIVES)} ${at(NOUNS)}`;
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** Two words from the general lists, e.g. "Sunny Biscuit". `random` returns a number in [0, 1). */
export function randomName(random: () => number): string {
  return nextName(undefined, new Set(), random);
}
