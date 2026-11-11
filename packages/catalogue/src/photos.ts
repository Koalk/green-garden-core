// SPDX-License-Identifier: AGPL-3.0-only

/** Widths the apps ask Commons for: the bundled thumbnail and the detail view. */
export const PHOTO_SIZES = { thumb: 320, detail: 800 } as const;

const COMMONS = "https://commons.wikimedia.org/wiki/";

/** Commons URL form of a file name: spaces become underscores, the rest is percent-encoded like MediaWiki does. */
function titleOf(file: string): string {
  return encodeURIComponent(file.trim().replace(/ /g, "_"))
    .replace(/%2C/gi, ",")
    .replace(/'/g, "%27");
}

/** The Commons page of a file (credit link). */
export function commonsFilePageUrl(file: string): string {
  return `${COMMONS}File:${titleOf(file)}`;
}

/** The photo itself at a width (Special:FilePath redirects to the scaled file); no width gives the original. */
export function commonsFileUrl(file: string, width?: number): string {
  if (width !== undefined && (!Number.isInteger(width) || width <= 0)) {
    throw new RangeError("width must be a positive integer");
  }
  const base = `${COMMONS}Special:FilePath/${titleOf(file)}`;
  return width === undefined ? base : `${base}?width=${String(width)}`;
}

/**
 * Commons "LicenseShortName" to the stored licence id: CC0, public domain, and every CC BY / CC BY-SA
 * version 2.0, 3.0 or 4.0 (a port suffix such as "de" is dropped; the licence URL keeps it). Anything else
 * (NC, ND, GFDL, unversioned, unknown) is undefined.
 */
export function normaliseCommonsLicence(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "cc0" || s === "cc0 1.0") return "CC0-1.0";
  if (s === "public domain" || s === "public domain mark 1.0" || s === "pd") return "PDM-1.0";
  const m = /^cc by(-sa)? ([234]\.0)(?: [a-z]{2,3})?$/.exec(s);
  if (m === null) return undefined;
  return `CC-BY${m[1] === undefined ? "" : "-SA"}-${m[2] ?? ""}`;
}
