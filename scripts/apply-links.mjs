// SPDX-License-Identifier: AGPL-3.0-only
// store harvested es/it "learn more" links in catalogue-draft/*.json (no model). Reads every
// the harvest folder's *.tsv, picks up to 3 links per language per entry (species and synonym matches,
// pages opened) and writes the genus-only pages to a list for review.
//
//   node scripts/apply-links.mjs [--ids a,b] [--dir harvest-folder] [--dry]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { genusRows, parseTsv, pickLinks } from "./harvest-links-lib.mjs";

const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Site order is the sites' ranking within each language; publisher names as the sites style them. */
const SITES = [
  { host: "consultaplantas.com", lang: "es", publisher: "Consulta Plantas" },
  { host: "verdeesvida.es", lang: "es", publisher: "Verde es Vida" },
  { host: "giardinaggio.it", lang: "it", publisher: "Giardinaggio.it" },
  { host: "ass-agir.it", lang: "it", publisher: "Ass-Agir" },
  { host: "piante.it", lang: "it", publisher: "Piante.it" },
];
const siteOf = (url) => {
  const host = new URL(url).host.replace(/^www\./, "");
  return SITES.findIndex((s) => host === s.host);
};
const describe = (url) => SITES[siteOf(url)] ?? null;

const { values: a } = parseArgs({
  options: {
    ids: { type: "string" },
    dir: { type: "string" },
    dry: { type: "boolean", default: false },
  },
});
const spikes = a.dir ?? join(repo, ".cache", "link-harvest");
const rows = readdirSync(spikes)
  .filter((f) => f.endsWith(".tsv"))
  .sort()
  .flatMap((f) => parseTsv(readFileSync(join(spikes, f), "utf8")))
  .filter((r) => siteOf(r.url) >= 0)
  .sort((x, y) => siteOf(x.url) - siteOf(y.url));
const byId = Map.groupBy(rows, (r) => r.id);
const wanted = a.ids ? new Set(a.ids.split(",")) : null;

const stats = { es: 0, it: 0, entries: 0 };
const touched = [];
const genus = [];
const dir = join(repo, "catalogue-draft");
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
  const path = join(dir, f);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const e of doc.entries ?? []) {
    if (wanted && !wanted.has(e.id)) continue;
    stats.entries++;
    const mine = byId.get(e.id) ?? [];
    genus.push(...genusRows(mine));
    const have = new Set((e.links ?? []).map((l) => l.url));
    const picks = pickLinks(mine, describe, 3).filter((l) => !have.has(l.url));
    if (!picks.length) continue;
    e.links = [...(e.links ?? []), ...picks];
    for (const l of picks) stats[l.lang]++;
    changed = true;
  }
  if (changed) {
    touched.push(path);
    if (!a.dry) writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  }
}
if (touched.length && !a.dry) console.log("now run: pnpm exec prettier --write catalogue-draft");
console.log(
  `${a.dry ? "(dry) " : ""}entries seen ${stats.entries}, with new links ${touched.length}; es ${stats.es}, it ${stats.it}`,
);
const genusList = join(spikes, "genus-only-s195.tsv");
if (!a.dry) {
  const uniq = [...new Map(genus.map((r) => [`${r.id}\t${r.url}`, r])).values()];
  writeFileSync(
    genusList,
    ["id\turl\ttitle\tnamed"]
      .concat(uniq.map((r) => [r.id, r.url, r.title, r.named].join("\t")))
      .join("\n") + "\n",
  );
  console.log(`${uniq.length} genus-only pages listed in ${genusList}`);
}
