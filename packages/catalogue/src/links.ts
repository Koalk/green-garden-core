// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Learn more" links: an entry's own `links` plus its fetched sources that have a URL, returned
 * in the app's language. Pure; the UI decides how to show them.
 */

export type LinkKind = "care" | "toxicity" | "botanical";
export const LINK_KINDS: readonly LinkKind[] = ["care", "toxicity", "botanical"];

export interface LearnLink {
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  /** Base language of the page: `en`, `es`, `it`. */
  readonly lang: string;
  readonly kind: LinkKind;
}

/** A link for one language; `inEnglish` marks an English page shown to someone whose language has none. */
export interface ResolvedLink extends LearnLink {
  readonly inEnglish: boolean;
}

/** The parts of a catalogue file's source that make a link. */
export interface LinkSource {
  readonly id?: string;
  readonly title: string;
  readonly publisher?: string;
  readonly url?: string;
  readonly kind?: string;
  /** Link role when it is not plain care advice (an animal-poison database is `toxicity`). */
  readonly linkKind?: string;
  readonly lang?: string;
}

const baseLang = (locale: string): string => locale.split("-")[0]?.toLowerCase() ?? "en";

/** The entry's `links` followed by its sources with a URL, as links (a source without `lang` is English). */
export function linksOfEntry(
  entry: { readonly links?: readonly LearnLink[] },
  sources: readonly LinkSource[],
): LearnLink[] {
  const own = [...(entry.links ?? [])];
  for (const s of sources) {
    if (s.kind === "author_knowledge" || s.url === undefined || s.url === "") continue;
    const kind = LINK_KINDS.find((k) => k === s.linkKind) ?? "care";
    own.push({
      url: s.url,
      title: s.title,
      publisher: s.publisher ?? s.title,
      lang: s.lang ?? "en",
      kind,
    });
  }
  return own;
}

/**
 * The links to show for `locale`: pages in that language first, then English pages of any kind that
 * language has none of (an animal-poison database exists only in English), marked `inEnglish`. A
 * language with no pages at all gets the English ones, marked. English readers see no marks.
 */
export function learnMoreLinks(links: readonly LearnLink[], locale: string): ResolvedLink[] {
  const want = baseLang(locale);
  const seen = new Set<string>();
  const unique = links.filter((l) => !seen.has(l.url) && seen.add(l.url));
  const mine = unique.filter((l) => l.lang === want).map((l) => ({ ...l, inEnglish: false }));
  if (want === "en") return mine;
  const have = new Set(mine.map((l) => l.kind));
  const english = unique
    .filter((l) => l.lang === "en" && !have.has(l.kind))
    .map((l) => ({ ...l, inEnglish: true }));
  return [...mine, ...english];
}
