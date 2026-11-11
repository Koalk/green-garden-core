// SPDX-License-Identifier: AGPL-3.0-only
// One-off, kept as a record: merges the look-alike research data (scripts/lookalikes.json, from
// features/01g-lookalikes-and-names.md) into catalogue-draft/*.json as lookAlikes, lookAlikeNote,
// nameIdeas and photoFile. Species without an row are left alone (field absent = not researched).
// Photo files are candidates, unverified: the browser reads licence and author from Commons itself.
// Run: node scripts/merge-lookalikes.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { root } from "./lib.mjs";

const dir = `${root}/catalogue-draft`;
const rows = JSON.parse(readFileSync(`${root}/scripts/lookalikes.json`, "utf8"));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const docs = files.map((f) => ({ f, json: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) }));

const key = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
const byName = new Map();
for (const { json } of docs) {
  const e = json.entries[0];
  byName.set(key(e.taxon.scientificName), e.id);
  for (const n of e.names.common) byName.set(key(n.name), e.id);
}

const unmatchedNote = [];
for (const { f, json } of docs) {
  const e = json.entries[0];
  const row = rows.find((r) => r.scientific === e.taxon.scientificName);
  if (row === undefined) continue;
  const lookAlikes = row.lookalikes
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .map((name) => {
      const species = byName.get(key(name));
      return {
        name,
        ...(species !== undefined && species !== e.id ? { species } : {}),
        tell: row.tell_apart,
      };
    });
  e.lookAlikes = lookAlikes;
  const flag = row.care_or_toxicity_flag;
  if (flag && !/^none/i.test(flag)) e.lookAlikeNote = flag;
  e.nameIdeas = row.name_ideas;
  if (row.photo?.file) e.photoFile = row.photo.file;
  writeFileSync(`${dir}/${f}`, JSON.stringify(json, null, 2) + "\n");
  unmatchedNote.push(`${e.id}: ${lookAlikes.map((l) => l.species ?? "-").join(",")}`);
}
console.log(unmatchedNote.join("\n"));
