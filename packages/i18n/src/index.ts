// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Message lookup and locale-aware formatting for the UI and the exports. The engine does not use this
 * package: it returns codes and numbers, never prose.
 */
import { formatMessage, type Params } from "./message.ts";
import { CATALOGUES } from "./catalogues.ts";
import meta from "./locales/meta.json" with { type: "json" };

export { formatMessage, placeholdersOf, type Params } from "./message.ts";

export const DEFAULT_LOCALE = "en-GB";

export type Catalogue = Readonly<Record<string, string>>;
export type Catalogues = Readonly<Record<string, Catalogue>>;

export interface LocaleInfo {
  readonly tag: string;
  /** The language's own name, for the picker. */
  readonly name: string;
  /** An AI draft nobody has signed off yet; the picker says so. */
  readonly machine: boolean;
}

/** Shipped locales. A locale is `machine` until a native reviewer signs the file off (D-30). */
export const LOCALES: readonly LocaleInfo[] = Object.entries(meta).map(([tag, m]) => ({
  tag,
  name: m.name,
  machine: m.machine,
}));

export { CATALOGUES };

/** `es-MX` gives `["es-MX", "es"]`; the default locale is always the last resort. */
function chain(locale: string): string[] {
  const out = [locale];
  const lang = locale.split("-")[0];
  if (lang !== undefined && lang !== locale) out.push(lang);
  if (!out.includes(DEFAULT_LOCALE)) out.push(DEFAULT_LOCALE);
  return out;
}

export type Translate = (key: string, params?: Params) => string;

/**
 * A translator for one locale. Falls back per string: regional tag, language, then en-GB. A broken
 * translation (bad ICU syntax) falls through to the next entry instead of breaking the screen, and a key
 * nobody has shows as the key.
 */
export function createTranslator(locale: string, catalogues: Catalogues = CATALOGUES): Translate {
  const order = chain(locale);
  return (key, params = {}) => {
    for (const tag of order) {
      const template = catalogues[tag]?.[key];
      if (template === undefined) continue;
      try {
        return formatMessage(template, params, tag === DEFAULT_LOCALE ? DEFAULT_LOCALE : locale);
      } catch {
        // try the next locale in the chain
      }
    }
    return key;
  };
}

let current = DEFAULT_LOCALE;
let translate = createTranslator(current);

export function getLocale(): string {
  return current;
}

/** Sets the locale `t()` uses. Unknown tags still work through the fallback chain. */
export function setLocale(locale: string): void {
  current = locale;
  translate = createTranslator(locale);
}

/** Translate with the active locale. */
export const t: Translate = (key, params) => translate(key, params);

/**
 * First requested language we ship, ignoring region (`es-ES` gives `es`, `en-US` gives `en-GB`). Falls
 * back to en-GB.
 */
export function negotiateLocale(
  requested: readonly string[],
  available: readonly string[] = LOCALES.map((l) => l.tag),
): string {
  for (const r of requested) {
    const lang = r.split("-")[0]?.toLowerCase();
    const hit =
      available.find((a) => a.toLowerCase() === r.toLowerCase()) ??
      available.find((a) => a.split("-")[0]?.toLowerCase() === lang);
    if (hit !== undefined) return hit;
  }
  return DEFAULT_LOCALE;
}

/** Whether the locale file is still a machine translation. */
export function isMachineTranslated(locale: string): boolean {
  return LOCALES.find((l) => l.tag === locale)?.machine ?? false;
}

/** Formats an ISO `YYYY-MM-DD` date. The date is read as a calendar date, so no timezone can shift it. */
export function formatDate(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

const AND: Readonly<Record<string, string>> = { en: "and", es: "y", it: "e" };

/** "a, b and c". Hermes has no `Intl.ListFormat`, so the shipped locales have a small fallback. */
export function formatList(items: readonly string[], locale: string): string {
  if (typeof Intl.ListFormat === "function") {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  }
  const lang = locale.split("-")[0]?.toLowerCase() ?? "en";
  const last = items[items.length - 1];
  if (last === undefined) return "";
  if (items.length === 1) return last;
  // Spanish says "e" before a word starting with i or hi (not hie, hia).
  const and = lang === "es" && /^h?i(?![aeo])/i.test(last) ? "e" : (AND[lang] ?? "and");
  return `${items.slice(0, -1).join(", ")} ${and} ${last}`;
}

/** 2026-11-01 was a Sunday, so index 0 is Sunday. */
export function weekdayName(
  index: number,
  locale: string,
  width: "short" | "long" = "short",
): string {
  const day = 1 + (((index % 7) + 7) % 7);
  return formatDate(`2026-11-0${String(day)}`, locale, { weekday: width });
}

const MONDAY_FIRST = new Set(["en-GB", "es", "it", "de", "fr"]);

/** Day the week starts on, 0 = Sunday: the platform's answer when it has one, else a small table. */
export function firstDayOfWeek(locale: string): number {
  if (typeof Intl.Locale === "function") {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info !== undefined) return info.firstDay % 7;
  }
  return MONDAY_FIRST.has(locale) || MONDAY_FIRST.has(locale.split("-")[0] ?? "") ? 1 : 0;
}

/** Whether the active locale chain has this key (so callers can pick a variant such as `.us`). */
export function hasMessage(key: string, locale: string = current): boolean {
  return chain(locale).some((tag) => CATALOGUES[tag]?.[key] !== undefined);
}
