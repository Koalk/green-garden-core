// SPDX-License-Identifier: AGPL-3.0-only
// pure helpers for fetch-photos.mjs (Commons API request, answer parsing, licence checks).
import { normaliseCommonsLicence } from "../packages/catalogue/src/photos.ts";

const API = "https://commons.wikimedia.org/w/api.php";

/** One API request for up to 50 files: url, extmetadata and a scaled copy (the thumb URL). */
export function infoRequestUrl(files, width = 640) {
  if (files.length > 50) throw new RangeError("Commons answers at most 50 titles a request");
  const titles = files.map((f) => `File:${f}`).join("|");
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit",
    iiurlwidth: String(width),
    titles,
  });
  return `${API}?${q.toString()}`;
}

const plain = (html) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const val = (meta, key) => meta?.[key]?.value;

/** Commons answer to Map(file name -> record). Titles are matched through "normalized" so spaces and case survive. */
export function parseInfo(json, asked) {
  const out = new Map();
  const renamed = new Map((json?.query?.normalized ?? []).map((n) => [n.to, n.from]));
  for (const page of Object.values(json?.query?.pages ?? {})) {
    const title = renamed.get(page.title) ?? page.title;
    const file = title.replace(/^File:/, "");
    if (!asked.includes(file)) continue;
    const info = page.imageinfo?.[0];
    if (page.missing !== undefined || info === undefined) {
      out.set(file, { file, missing: true });
      continue;
    }
    const raw = val(info.extmetadata, "LicenseShortName") ?? "";
    out.set(file, {
      file,
      licenceRaw: raw,
      licence: normaliseCommonsLicence(raw) ?? null,
      creator: plain(val(info.extmetadata, "Artist") ?? ""),
      licenceUrl: val(info.extmetadata, "LicenseUrl") ?? null,
      pageUrl: info.descriptionurl,
      thumbUrl: info.thumburl,
      width: info.width,
      height: info.height,
    });
  }
  return out;
}

/** Differences between an pick and what Commons says now. */
export function compareWithPick(pick, rec) {
  if (rec === undefined || rec.missing) return ["file missing on Commons"];
  const diffs = [];
  if (rec.licence === null) diffs.push(`licence not allowed: ${rec.licenceRaw}`);
  else if (rec.licence !== pick.licence) diffs.push(`licence ${pick.licence} -> ${rec.licence}`);
  if (rec.creator === "") diffs.push("no creator on Commons");
  else if (rec.creator !== pick.creator) diffs.push(`creator ${pick.creator} -> ${rec.creator}`);
  return diffs;
}
