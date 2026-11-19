// SPDX-License-Identifier: AGPL-3.0-only

/** The toxicity line (one sentence about pets and children). Unknown is never worded as safe. */
import type { Translate } from "@green-garden/i18n";

/** What the wording needs of a catalogue entry's toxicity: both catalogues' rows fit it. */
export interface Toxicity {
  readonly status: "assessed" | "unknown";
  readonly exposures: readonly { readonly who: string; readonly severity: number }[];
}

/** Who lives with the plants; absent or empty means "list everyone". */
export interface HouseholdInfo {
  readonly pets: readonly string[];
  readonly children?: boolean;
}

/**
 * One line about toxicity. Unknown is never worded as safe. With a household it speaks about them.
 * An assessed entry with no cat or dog exposure was graded for people only: the pets are "not assessed".
 */
export function toxicityText(tr: Translate, tox: Toxicity, household?: HouseholdInfo): string {
  if (tox.status === "unknown") return tr("tox.unknown");
  const everyone =
    household === undefined || (household.pets.length === 0 && household.children !== true);
  const mine = everyone
    ? undefined
    : new Set([...household.pets, ...(household.children === true ? ["child"] : [])]);
  const petsNotAssessed =
    !tox.exposures.some((x) => x.who === "cat" || x.who === "dog") &&
    (everyone || household.pets.length > 0);
  const affected = tox.exposures.filter((x) => x.severity > 0);
  const hit = mine === undefined ? affected : affected.filter((x) => mine.has(x.who));
  const note = petsNotAssessed ? tr("tox.petsNotAssessed") : undefined;
  if (hit.length === 0) {
    if (note === undefined) return tr(affected.length === 0 ? "tox.none" : "tox.noneForHousehold");
    return mine === undefined && affected.length === 0
      ? `${tr("tox.noneForPeople")} ${note}`
      : note;
  }
  const worst = new Map<string, number>();
  for (const x of hit) worst.set(x.who, Math.max(worst.get(x.who) ?? 0, x.severity));
  const parts = [...worst].map(([who, severity]) =>
    tr("tox.part", { who: tr(`tox.who.${who}`), severity: tr(`tox.severity.${String(severity)}`) }),
  );
  const line = tr("tox.toxicTo", { parts: parts.join(", ") });
  return note !== undefined ? `${line} ${note}` : line;
}

/** The highest severity of any exposure (0 to 3); `undefined` when not assessed, never "safe". */
export function toxicityLevel(tox: Toxicity): 0 | 1 | 2 | 3 | undefined {
  if (tox.status === "unknown") return undefined;
  const top = Math.max(0, ...tox.exposures.map((x) => x.severity));
  return top >= 3 ? 3 : top === 2 ? 2 : top === 1 ? 1 : 0;
}
