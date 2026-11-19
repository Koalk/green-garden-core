// SPDX-License-Identifier: AGPL-3.0-only

/** Checks behind `pnpm i18n:check`: the locale files are consistent with en-GB and with the code. */
import { formatMessage, placeholdersOf, pluralKeysOf } from "./message.ts";

export { pluralKeysOf };

type Catalogue = Readonly<Record<string, string>>;
type Meta = Readonly<Record<string, { readonly name: string; readonly machine: boolean }>>;

export interface Usage {
  /** Every key-looking string literal in the source. */
  readonly literals: ReadonlySet<string>;
  /** Template prefixes such as `outcome.` from `` t(`outcome.${x}`) ``. */
  readonly prefixes: ReadonlySet<string>;
  /** Keys passed straight to `t("...")` or `tHtml("...")`. */
  readonly asked: ReadonlySet<string>;
}

export interface CheckInput {
  readonly catalogues: Readonly<Record<string, Catalogue>>;
  readonly meta: Meta;
  readonly usage: Usage;
  readonly defaultLocale?: string;
}

export interface CheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

const KEY = /["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)["'`]/g;
const PREFIX = /`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*\.)\$\{/g;
const ASKED = /\bt(?:Html)?\(\s*["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)["'`]/g;

/** Message keys a piece of source code uses. */
export function usedKeysIn(src: string): {
  literals: Set<string>;
  prefixes: Set<string>;
  asked: Set<string>;
} {
  const grab = (re: RegExp): Set<string> =>
    new Set([...src.matchAll(re)].map((m) => m[1] ?? "").filter((x) => x !== ""));
  return { literals: grab(KEY), prefixes: grab(PREFIX), asked: grab(ASKED) };
}

/** A new locale file starts as a copy of the English text, so it is complete and nothing shows a key. */
export function newLocaleFile(en: Catalogue): Record<string, string> {
  return { ...en };
}

export function checkCatalogues(input: CheckInput): CheckResult {
  const base = input.defaultLocale ?? "en-GB";
  const errors: string[] = [];
  const warnings: string[] = [];
  const en = input.catalogues[base] ?? {};

  for (const [key, text] of Object.entries(en)) {
    try {
      formatMessage(text, {}, base);
    } catch (e) {
      errors.push(`${base}: ${key}: ICU syntax: ${(e as Error).message}`);
    }
    const used =
      input.usage.literals.has(key) || [...input.usage.prefixes].some((p) => key.startsWith(p));
    if (!used) errors.push(`${base}: ${key}: unused key (no t() call or prefix refers to it)`);
  }
  for (const key of input.usage.asked) {
    if (!(key in en)) errors.push(`${key}: asked for in code but not in ${base}`);
  }

  for (const [locale, cat] of Object.entries(input.catalogues)) {
    if (locale === base) continue;
    const info = input.meta[locale];
    if (info === undefined) {
      errors.push(`${locale}: no entry in locales/meta.json`);
      continue;
    }
    const categories = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    for (const [key, text] of Object.entries(cat)) {
      const source = en[key];
      if (source === undefined) {
        errors.push(`${locale}: ${key}: unknown key (not in ${base})`);
        continue;
      }
      let theirs: string[];
      try {
        theirs = placeholdersOf(text);
        formatMessage(text, {}, locale);
      } catch (e) {
        errors.push(`${locale}: ${key}: ICU syntax: ${(e as Error).message}`);
        continue;
      }
      const ours = placeholdersOf(source);
      if (theirs.join(",") !== ours.join(",")) {
        errors.push(
          `${locale}: ${key}: placeholders differ (${theirs.join(", ")} instead of ${ours.join(", ")})`,
        );
      }
      for (const k of pluralKeysOf(text)) {
        if (!k.startsWith("=") && k !== "other" && !categories.has(k as Intl.LDMLPluralRule)) {
          errors.push(`${locale}: ${key}: plural category "${k}" does not exist in ${locale}`);
        }
      }
    }
    for (const key of Object.keys(en)) {
      if (key in cat || key.endsWith(".us")) continue; // regional variants are optional
      // A machine draft may lag behind (English shows through); a reviewed language must be complete.
      (info.machine ? warnings : errors).push(`${locale}: ${key}: missing translation`);
    }
  }
  return { errors, warnings };
}
