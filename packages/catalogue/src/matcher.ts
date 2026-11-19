// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plant name matcher for bulk add. Pure: no network, no dependency. Takes what a person typed
 * ("big kitchen monstra, snake plnat\nlengua de suegra") and the catalogue, and returns for each plant
 * name a ranked list of catalogue candidates with a score from 0 to 1, the reason for each, and a
 * verdict: `confident` (preselect it), `choose` (ask: 1 to 4 close candidates) or `none`.
 *
 * How a name is scored (see the package README for the thresholds and why):
 * - Names are lower-cased, stripped of accents and punctuation, split into words; small words ("de",
 *   "of", "the") are dropped and plurals folded, on both sides.
 * - Every catalogue name (scientific, common names in every language, synonyms) is a "form". The
 *   input words are aligned to a form's words: equal words, then words within a length-scaled number
 *   of edits (Damerau-Levenshtein). The score depends on how much of the form is covered, how many
 *   input words found no partner, and how many edits it took.
 * - A bare genus ("hedera", "pelargonium") matches the first word of a scientific name or synonym. If
 *   some entry is named exactly that word, entries that only match through a synonym step aside.
 * - Any plant with a look-alike entry is a `choose`, however fully it was named.
 * - Words like "big", "kitchen" or "my" are tried both kept and dropped.
 */

/** The part of a catalogue entry the matcher reads. The real catalogue entry is a superset. */
export interface MatcherEntry {
  readonly id: string;
  readonly taxon: { readonly scientificName: string };
  readonly names: {
    readonly common: readonly {
      readonly lang: string;
      readonly name: string;
      readonly primary?: boolean;
    }[];
    readonly synonyms?: readonly string[];
  };
  /** Only `species` (an entry id in the same catalogue) is used: look-alikes we have an entry for. */
  readonly lookAlikes?: readonly { readonly species?: string }[];
}

export type Verdict = "confident" | "choose" | "none";

/**
 * Why a candidate matched.
 * - exact: scientific name, or a common name in the locale's language (case, accents, plurals ignored)
 * - common: a common name in another language
 * - alias: a scientific synonym
 * - typo: right words with spelling mistakes, or the same letters with different spacing
 * - partial: some words of a longer name ("snake" for "snake plant"), possibly with extra words
 * - genus: the genus alone
 * - word-order: the right words in another order
 * - lookalike: not matched by text; added because it is confused with the top candidate
 */
export type MatchReason =
  "exact" | "common" | "alias" | "typo" | "partial" | "genus" | "word-order" | "lookalike";

export interface Candidate {
  readonly id: string;
  /** 0 to 1. Not a probability: compare scores within one input only. */
  readonly score: number;
  readonly reason: MatchReason;
  /** The catalogue name that matched, as written in the catalogue. */
  readonly matched: string;
  /** The language of `matched` when it is a common name. */
  readonly lang?: string;
  /** What to show for this plant in the locale: its primary name there, else English, else scientific. */
  readonly label: string;
}

export interface MatchResult {
  /** The piece of the input this result is about (one plant name), trimmed, list markers removed. */
  readonly input: string;
  /** Position among all the plant names found in the call. */
  readonly index: number;
  readonly verdict: Verdict;
  /**
   * confident: the best match first, then up to 3 alternatives. choose: the 1 to 4 close candidates
   * (1 only when the one candidate is weak). none: empty.
   */
  readonly candidates: readonly Candidate[];
  /** "2 pothos", "pothos x2": 2. Otherwise 1. */
  readonly count: number;
  /** Index of the earlier result for the same plant, when this name repeats one. */
  readonly duplicateOf?: number;
}

export interface MatchOptions {
  /** BCP 47 tag, default "en". Names in this language count as exact, others as `common`. */
  readonly locale?: string;
}

/** The score thresholds, exported so the UI and the tests quote the same numbers. */
export const MATCH_THRESHOLDS = {
  /** Below this a candidate is not reported. */
  min: 0.5,
  /** The best candidate must reach this to be confident. */
  confident: 0.65,
  /** Another candidate within this of the best one makes the verdict `choose`. */
  margin: 0.2,
  /** Most candidates in a result. */
  maxCandidates: 4,
} as const;

const GENUS_SCORE = 0.85;
const COMMON_OTHER_LANG_SCORE = 0.97;
const ALIAS_SCORE = 0.95;
const WORD_ORDER_SCORE = 0.9;
const SPACING_SCORE = 0.9;
const NOISE_PENALTY = 0.98;
const EXTRA_WORD_FACTOR = 0.75;

// Words dropped on both sides (articles, prepositions, "and"). Compared before folding plurals.
const STOP = new Set(
  (
    "of the and in a an on with " +
    "de del la las el los un una y con en " +
    "di dei delle della dello degli da il lo le gli i un uno una e con"
  ).split(" "),
);
// Words describing the plant's size, owner or place, dropped from the input (kept on a second try).
const NOISE_RAW =
  "my our mine big small little tiny large huge giant new old young pretty " +
  "kitchen bedroom bathroom living room hall hallway office garden indoor outdoor balcony terrace patio " +
  "mi mis nuestra grande pequeno pequena cocina salon dormitorio bano jardin interior exterior balcon " +
  "mia mio miei grande piccolo piccola cucina camera bagno giardino salotto soggiorno";
// Words that name no plant on their own. A match on these alone is never a match.
const GENERIC_RAW = "plant planta pianta tree flower";

/** Plural folding good enough for plant names in en, es and it. Applied to both sides. */
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(?:ss|us|is|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

const NOISE = new Set(NOISE_RAW.split(" ").map(stem));
const GENERIC = new Set(GENERIC_RAW.split(" ").map(stem));

/** Words of a name: lower case, no accents or punctuation, no small words, plurals folded. */
function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** How many edits a word of this length may have and still count as the same word. */
function allowance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 10) return 2;
  return 3;
}

/** Optimal string alignment distance (edits and adjacent swaps); `max + 1` as soon as it is above `max`. */
function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

const weight = (w: string): number => (GENERIC.has(w) ? 1.5 : w.length);

type FormKind = "sci" | "common" | "alias" | "genus";

interface Form {
  readonly entry: number;
  readonly kind: FormKind;
  readonly lang: string | undefined;
  /** A common name in the locale's language. */
  readonly local: boolean;
  readonly text: string;
  readonly tokens: readonly string[];
  readonly joined: string;
  /** A genus form that exists only because a synonym of the entry starts with it. */
  readonly viaSynonym?: boolean;
}

interface Index {
  readonly entries: readonly MatcherEntry[];
  readonly forms: readonly Form[];
  readonly byToken: ReadonlyMap<string, readonly number[]>;
  readonly vocabByLength: ReadonlyMap<number, readonly string[]>;
  readonly byJoined: ReadonlyMap<string, readonly number[]>;
  readonly labels: readonly string[];
  /** Undirected look-alike links between entry positions. */
  readonly alikes: ReadonlyMap<number, ReadonlySet<number>>;
}

const langBase = (tag: string): string => tag.toLowerCase().split("-")[0] ?? "";

function buildIndex(entries: readonly MatcherEntry[], locale: string): Index {
  const base = langBase(locale);
  const forms: Form[] = [];
  const labels: string[] = [];
  const position = new Map<string, number>();
  entries.forEach((e, i) => position.set(e.id, i));

  entries.forEach((e, entry) => {
    const seen = new Set<string>();
    const add = (kind: FormKind, text: string, lang?: string, viaSynonym = false): void => {
      const tokens = words(text);
      const joined = tokens.join("");
      if (tokens.length === 0 || seen.has(`${kind}:${joined}`)) return;
      seen.add(`${kind}:${joined}`);
      forms.push({
        entry,
        kind,
        lang,
        local: kind === "common" && lang !== undefined && langBase(lang) === base,
        text,
        tokens,
        joined,
        ...(viaSynonym ? { viaSynonym } : {}),
      });
    };
    const addTaxon = (kind: "sci" | "alias", text: string): void => {
      add(kind, text);
      const genus = words(text);
      if (genus.length >= 2 && genus[0] !== undefined) {
        add("genus", genus[0], undefined, kind === "alias");
      }
    };
    addTaxon("sci", e.taxon.scientificName);
    for (const c of e.names.common) add("common", c.name, c.lang);
    for (const s of e.names.synonyms ?? []) addTaxon("alias", s);

    const pickName = (
      pred: (c: MatcherEntry["names"]["common"][number]) => boolean,
    ): string | undefined =>
      e.names.common.find((c) => pred(c) && c.primary === true)?.name ??
      e.names.common.find(pred)?.name;
    labels.push(
      pickName((c) => langBase(c.lang) === base) ??
        pickName((c) => langBase(c.lang) === "en") ??
        e.names.common[0]?.name ??
        e.taxon.scientificName,
    );
  });

  const byToken = new Map<string, number[]>();
  const byJoined = new Map<string, number[]>();
  forms.forEach((f, id) => {
    for (const t of new Set(f.tokens)) {
      const list = byToken.get(t);
      if (list) list.push(id);
      else byToken.set(t, [id]);
    }
    const j = byJoined.get(f.joined);
    if (j) j.push(id);
    else byJoined.set(f.joined, [id]);
  });
  const vocab = new Map<number, string[]>();
  for (const t of byToken.keys()) {
    const list = vocab.get(t.length);
    if (list) list.push(t);
    else vocab.set(t.length, [t]);
  }

  const alikes = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    if (a === b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const s = alikes.get(x);
      if (s) s.add(y);
      else alikes.set(x, new Set([y]));
    }
  };
  entries.forEach((e, i) => {
    for (const l of e.lookAlikes ?? []) {
      const j = l.species === undefined ? undefined : position.get(l.species);
      if (j !== undefined) link(i, j);
    }
  });

  return { entries, forms, byToken, vocabByLength: vocab, byJoined, labels, alikes };
}

interface Scored {
  readonly score: number;
  readonly reason: MatchReason;
}

/** Aligns input words to one form's words. Undefined when they share nothing that names a plant. */
function align(input: readonly string[], form: Form, joinedHit: boolean): Scored | undefined {
  const ft = form.tokens;
  const used: boolean[] = ft.map(() => false);
  const partner: number[] = input.map(() => -1);
  let edits = 0;
  input.forEach((w, i) => {
    const j = ft.findIndex((f, k) => !used[k] && f === w);
    if (j >= 0) {
      used[j] = true;
      partner[i] = j;
    }
  });
  input.forEach((w, i) => {
    if (partner[i] !== -1) return;
    const a = allowance(w.length);
    if (a === 0) return;
    let best = -1;
    let bestD = a + 1;
    ft.forEach((f, k) => {
      if (used[k]) return;
      const d = distance(w, f, a);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best >= 0) {
      used[best] = true;
      partner[i] = best;
      edits += bestD;
    }
  });

  let matchedWeight = 0;
  let totalWeight = 0;
  let real = false;
  for (const [k, f] of ft.entries()) {
    totalWeight += weight(f);
    if (used[k] === true) {
      matchedWeight += weight(f);
      if (!GENERIC.has(f)) real = true;
    }
  }
  if (!real) return undefined;
  const coverage = matchedWeight / totalWeight;
  const extra = input.filter((w, i) => partner[i] === -1 && !GENERIC.has(w)).length;
  const inOrder = partner
    .filter((j) => j >= 0)
    .every((j, n, all) => n === 0 || j > (all[n - 1] ?? -1));

  let out: Scored;
  if (extra === 0 && coverage > 0.999) {
    if (edits === 0)
      out = inOrder
        ? { score: 1, reason: "exact" }
        : { score: WORD_ORDER_SCORE, reason: "word-order" };
    else {
      out = { score: Math.max(0.5, 0.95 - 0.09 * edits) * (inOrder ? 1 : 0.95), reason: "typo" };
    }
  } else {
    const base = coverage > 0.999 ? 1 : 0.55 + 0.25 * coverage;
    out = {
      score: base * Math.max(0.5, 1 - 0.1 * edits) * EXTRA_WORD_FACTOR ** extra,
      reason: "partial",
    };
  }
  if (joinedHit && out.score < SPACING_SCORE) out = { score: SPACING_SCORE, reason: "typo" };
  return out;
}

/** Applies what kind of name the form is to a raw alignment. */
function adjust(raw: Scored, form: Form): Scored | undefined {
  switch (form.kind) {
    case "sci":
      return raw;
    case "genus":
      // A genus is only worth something when the input is that genus (maybe misspelt), not part of one.
      return raw.reason === "partial"
        ? undefined
        : { score: Math.min(raw.score, GENUS_SCORE), reason: "genus" };
    case "alias":
      return raw.reason === "exact"
        ? { score: ALIAS_SCORE, reason: "alias" }
        : { score: Math.min(raw.score, ALIAS_SCORE), reason: raw.reason };
    case "common":
      return !form.local && raw.reason === "exact"
        ? { score: COMMON_OTHER_LANG_SCORE, reason: "common" }
        : raw;
  }
}

function seedForms(ix: Index, input: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const w of input) {
    if (GENERIC.has(w)) continue;
    const hit = ix.byToken.get(w);
    if (hit) for (const id of hit) ids.add(id);
    // A word that exists may still be a slip for another plant ("geranio" / "geranium"): long words only.
    const a = allowance(w.length);
    if (a === 0 || (hit !== undefined && w.length < 6)) continue;
    for (let len = w.length - a; len <= w.length + a; len++) {
      for (const v of ix.vocabByLength.get(len) ?? []) {
        if (distance(w, v, a) <= a) for (const id of ix.byToken.get(v) ?? []) ids.add(id);
      }
    }
  }
  const joined = ix.byJoined.get(input.join(""));
  if (joined) for (const id of joined) ids.add(id);
  return ids;
}

interface Hit extends Scored {
  readonly form: Form;
}

/** Best hit per entry for one reading of the input. */
function scoreVariant(ix: Index, input: readonly string[], factor: number): Map<number, Hit> {
  const best = new Map<number, Hit>();
  if (input.length === 0) return best;
  const joined = input.join("");
  for (const id of seedForms(ix, input)) {
    const form = ix.forms[id];
    if (form === undefined) continue;
    const spaced = form.joined === joined;
    const raw =
      align(input, form, spaced) ??
      (spaced ? { score: SPACING_SCORE, reason: "typo" as const } : undefined);
    const adj = raw === undefined ? undefined : adjust(raw, form);
    if (adj === undefined) continue;
    const score = adj.score * factor;
    const cur = best.get(form.entry);
    if (cur === undefined || score > cur.score) best.set(form.entry, { ...adj, score, form });
  }
  return best;
}

/** What a person typed for one plant: the name, how many, and the words to match. */
function parseSegment(raw: string): { text: string; count: number } | undefined {
  let text = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
  let count = 1;
  const lead = /^(\d{1,3})(?:\s*[x×]\s*|\s+)(.+)$/i.exec(text);
  const trail = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(text);
  if (lead?.[1] !== undefined && lead[2] !== undefined) {
    count = Number(lead[1]);
    text = lead[2].trim();
  } else if (trail?.[1] !== undefined && trail[2] !== undefined) {
    count = Number(trail[2]);
    text = trail[1].trim();
  }
  return text === "" ? undefined : { text, count: Math.max(1, count) };
}

/** Reasons that mean the input is a whole name of the entry. */
const NAMED: ReadonlySet<MatchReason> = new Set(["exact", "common", "alias"]);

function matchOne(ix: Index, text: string, index: number, count: number): MatchResult {
  const tokens = words(text);
  const cleaned = tokens.filter((w) => !NOISE.has(w));
  const best = scoreVariant(ix, tokens, 1);
  if (cleaned.length !== tokens.length) {
    for (const [entry, hit] of scoreVariant(ix, cleaned, NOISE_PENALTY)) {
      const cur = best.get(entry);
      if (cur === undefined || hit.score > cur.score) best.set(entry, hit);
    }
  }

  const label = (entry: number): string => ix.labels[entry] ?? "";
  const toCandidate = (entry: number, h: Hit): Candidate => {
    const e = ix.entries[entry];
    return {
      id: e?.id ?? "",
      score: Math.round(h.score * 1000) / 1000,
      reason: h.reason,
      matched: h.form.text,
      ...(h.form.kind === "common" && h.form.lang !== undefined ? { lang: h.form.lang } : {}),
      label: label(entry),
    };
  };
  const rank = (list: Candidate[]): Candidate[] =>
    list.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let ranked = rank(
    [...best]
      .filter(([, h]) => h.score >= MATCH_THRESHOLDS.min)
      .map(([entry, h]) => toCandidate(entry, h)),
  );
  // A bare word that is exactly some entry's name ("sansevieria" as an entry of its own) belongs to
  // that entry: entries that only start with it through a species synonym step aside.
  if (cleaned.length === 1 && ranked.some((c) => NAMED.has(c.reason))) {
    const named = new Set(
      [...best]
        .filter(([, h]) => h.reason === "genus" && h.form.viaSynonym === true)
        .map(([e]) => ix.entries[e]?.id),
    );
    ranked = ranked.filter((c) => c.reason !== "genus" || !named.has(c.id));
  }
  const top = ranked[0];
  const result = (verdict: Verdict, candidates: readonly Candidate[]): MatchResult => ({
    input: text,
    index,
    verdict,
    candidates,
    count,
  });
  if (top === undefined) return result("none", []);

  // A plant that has a look-alike in the catalogue is never a silent pick, however fully it was named
  //: the look-alikes join the candidates just behind it.
  const position = ix.entries.findIndex((e) => e.id === top.id);
  const alikes = [...(ix.alikes.get(position) ?? [])];
  let all = ranked;
  if (alikes.length > 0) {
    const floor = Math.max(MATCH_THRESHOLDS.min, top.score - MATCH_THRESHOLDS.margin / 2);
    const lifted = new Map<string, Candidate>();
    for (const j of alikes) {
      const e = ix.entries[j];
      if (e === undefined) continue;
      const have = ranked.find((c) => c.id === e.id);
      lifted.set(
        e.id,
        have
          ? { ...have, score: Math.max(have.score, floor) }
          : { id: e.id, score: floor, reason: "lookalike", matched: label(j), label: label(j) },
      );
    }
    all = rank([...ranked.filter((c) => !lifted.has(c.id)), ...lifted.values()]);
  }

  const first = all[0];
  if (first === undefined) return result("none", []);
  const rivals = all.filter((c, i) => i > 0 && first.score - c.score < MATCH_THRESHOLDS.margin);
  if (first.score >= MATCH_THRESHOLDS.confident && rivals.length === 0) {
    return result("confident", all.slice(0, MATCH_THRESHOLDS.maxCandidates));
  }
  return result("choose", [first, ...rivals].slice(0, MATCH_THRESHOLDS.maxCandidates));
}

export type NameMatcher = (inputs: string | readonly string[]) => MatchResult[];

/**
 * Builds the index once for a catalogue and a locale; the returned function matches any number of
 * inputs. Use it when matching again and again against the same catalogue.
 */
export function createNameMatcher(
  catalogue: readonly MatcherEntry[],
  options: MatchOptions = {},
): NameMatcher {
  const ix = buildIndex(catalogue, options.locale ?? "en");
  return (inputs) => {
    const list = typeof inputs === "string" ? [inputs] : inputs;
    const segments = list
      .flatMap((s) => s.split(/[,;\n\r\t]+/))
      .map(parseSegment)
      .filter((s): s is { text: string; count: number } => s !== undefined);
    const results = segments.map((s, i) => matchOne(ix, s.text, i, s.count));

    // Flag repeats: the same confident plant, or the same words for names we could not place.
    const firstSeen = new Map<string, number>();
    return results.map((r) => {
      const top = r.candidates[0];
      // A choose that only exists because of look-alikes is still about its first candidate.
      const alikeOnly =
        r.verdict === "choose" &&
        top !== undefined &&
        top.score >= MATCH_THRESHOLDS.confident &&
        r.candidates.slice(1).every((c) => c.reason === "lookalike");
      const key =
        (r.verdict === "confident" || alikeOnly) && top !== undefined
          ? `id:${top.id}`
          : r.verdict === "choose"
            ? `words:${words(r.input).join(" ")}`
            : undefined;
      if (key === undefined) return r;
      const earlier = firstSeen.get(key);
      if (earlier === undefined) {
        firstSeen.set(key, r.index);
        return r;
      }
      return { ...r, duplicateOf: earlier };
    });
  };
}

const cache = new WeakMap<readonly MatcherEntry[], Map<string, NameMatcher>>();

/**
 * Matches typed plant names against the catalogue. `inputs` is one string or several; each may hold
 * several plants separated by commas, semicolons or new lines. One result per plant name, in order.
 */
export function matchNames(
  inputs: string | readonly string[],
  catalogue: readonly MatcherEntry[],
  options: MatchOptions = {},
): MatchResult[] {
  const locale = options.locale ?? "en";
  let byLocale = cache.get(catalogue);
  if (byLocale === undefined) {
    byLocale = new Map();
    cache.set(catalogue, byLocale);
  }
  let matcher = byLocale.get(locale);
  if (matcher === undefined) {
    matcher = createNameMatcher(catalogue, { locale });
    byLocale.set(locale, matcher);
  }
  return matcher(inputs);
}
