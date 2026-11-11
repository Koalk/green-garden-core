// SPDX-License-Identifier: AGPL-3.0-only
// write the photo picks into the catalogue entries, using the licence and creator that
// fetch-photos.mjs confirmed through the Commons API (<dir>/commons-info.json).
// Picks whose file is missing, whose licence is not allowed, or that have no creator are skipped and listed.
// Then run prettier on catalogue-draft. Usage: node scripts/apply-photos.mjs <picks.json> [photos-folder, default .cache/photos]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commonsFilePageUrl } from "../packages/catalogue/src/photos.ts";
import { root } from "./lib.mjs";

const info = JSON.parse(
  readFileSync(
    join(process.argv[3] ?? join(root, ".cache", "photos"), "commons-info.json"),
    "utf8",
  ),
);
const picks = new Map(JSON.parse(readFileSync(process.argv[2], "utf8")).map((p) => [p.id, p]));
const PDM_URL = "https://creativecommons.org/publicdomain/mark/1.0/";
const urlOf = (r, id) =>
  r.licenceUrl || picks.get(id)?.licenceUrl || (r.licence === "PDM-1.0" ? PDM_URL : undefined);
const byId = new Map(info.report.map((r) => [r.id, r]));
const skipped = [];
let applied = 0;
for (const [id, r] of byId) {
  const path = join(root, "catalogue-draft", `${id}.json`);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const entry = doc.entries.find((e) => e.id === id) ?? doc.entries[0];
  if (r.missing || r.licence === null || !r.creator || !urlOf(r, id)) {
    skipped.push(`${id}: ${r.diffs.join("; ") || "incomplete Commons metadata"}`);
    continue;
  }
  const photo = {
    file: r.file,
    licence: r.licence,
    creator: r.creator,
    licenceUrl: urlOf(r, id).replace(/^http:\/\//, "https://"),
    sourceUrl: commonsFilePageUrl(r.file),
    thumbnail: `${id}.webp`,
  };
  // Rebuild the entry so photoFile sits where photos does.
  const rebuilt = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === "photoFile") continue;
    rebuilt[k] = k === "photos" ? [photo] : v;
    if (k === "photos") rebuilt["photoFile"] = r.file;
  }
  doc.entries[doc.entries.indexOf(entry)] = rebuilt;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  applied++;
}
console.log(`photos written for ${applied} entries; skipped ${skipped.length}`);
for (const s of skipped) console.log(`  ${s}`);
