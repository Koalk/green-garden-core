// SPDX-License-Identifier: AGPL-3.0-only
// source-page cache for the catalogue research runs, no model (no model, polite delays). For each plant, opens the pages on the sites the research runs
// entries cite most and saves the ones that name the plant, so a batch reads small cached files instead of
// fetching 25 to 40 pages. One request every 3 seconds or slower, a site stops at its first HTTP 429, `--max` caps
// requests, a rerun resumes (raw answers are cached). Pages are cached for research only, never committed.
//
//   node scripts/fetch-sources.mjs --rows 87,88,89 [--ids a,b] [--plant "Sci name|Synonym|common|..."]
//        [--list <starter-list.md>] [--sites ncsu,aspca,mbg,clemson] [--max 200] [--delay 3000]
//
// mbg (plantfinder.mobot.org) sends an incomplete certificate chain: run with NODE_OPTIONS=--use-system-ca on Windows.
// Cache: <workspace>/.cache/gg-sources/<site>/<key>.html + .txt, manifest-*.tsv; copy of the manifest in --out.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { makeFetcher } from "./harvest-links-lib.mjs";
import {
  SOURCES,
  UNREADABLE,
  fetchPlant,
  parsePlantArg,
  parseStarterRows,
  toManifestTsv,
} from "./fetch-sources-lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..");
const USER_AGENT =
  "green-garden-source-cache/0.1 (open-source plant-care app; contact: repository owner)";

/** Catalogue entries as plants: english names from `names.common`, key = entry id. */
function readEntries(dir, wanted) {
  const out = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    for (const e of JSON.parse(readFileSync(join(dir, f), "utf8")).entries ?? []) {
      if (!wanted.has(e.id)) continue;
      out.push({
        key: e.id,
        entry: e.id,
        scientificName: e.taxon?.scientificName ?? e.id,
        synonyms: e.names?.synonyms ?? [],
        common: (e.names?.common ?? []).filter((c) => /^en/.test(c.lang)).map((c) => c.name),
      });
    }
  }
  return out;
}

async function main() {
  const { values: a } = parseArgs({
    options: {
      rows: { type: "string" },
      ids: { type: "string" },
      plant: { type: "string", multiple: true },
      sites: { type: "string" },
      max: { type: "string", default: "200" },
      delay: { type: "string", default: "3000" },
      list: { type: "string" },
      entries: { type: "string", default: join(repo, "catalogue-draft") },
      cache: { type: "string", default: join(repo, "..", ".cache", "gg-sources") },
      out: { type: "string", default: join(repo, ".cache", "source-cache") },
    },
  });
  const siteIds = a.sites ? a.sites.split(",") : Object.keys(SOURCES);
  const bad = siteIds.filter((s) => !SOURCES[s]);
  if (bad.length || !(a.rows || a.ids || a.plant)) {
    console.error(
      `usage: --rows <01c rows> and/or --ids <entry ids> and/or --plant "Sci|Synonym|common"; --sites from ${Object.keys(SOURCES).join(", ")}${bad.length ? ` (unknown: ${bad})` : ""}`,
    );
    process.exit(2);
  }
  const sources = siteIds.map((s) => SOURCES[s]);
  // Order matters: --plant first (the research runs put the calamondin entry first), then rows, then catalogue ids.
  const plants = (a.plant ?? []).map(parsePlantArg);
  if (a.rows) {
    if (!a.list) throw new Error("--rows needs --list <path to the starter-list markdown>");
    const rows = parseStarterRows(readFileSync(a.list, "utf8"));
    for (const n of a.rows.split(",").map(Number)) {
      const r = rows.find((x) => x.row === n);
      if (!r) throw new Error(`row ${n} not found in ${a.list}`);
      plants.push(r);
    }
  }
  if (a.ids) plants.push(...readEntries(a.entries, new Set(a.ids.split(","))));

  const fetcher = makeFetcher({
    fetchImpl: fetch,
    delayMs: Math.max(3000, Number(a.delay)),
    cacheDir: join(a.cache, "_raw"),
    userAgent: USER_AGENT,
    max: Number(a.max),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const rows = [];
  const stopped = new Set();
  let stop = null;
  let at = null;
  try {
    for (const plant of plants) {
      at = plant.key;
      rows.push(
        ...(await fetchPlant({
          get: fetcher.get,
          sources,
          plant,
          cacheRoot: a.cache,
          stopped,
          onStop: (site, err) =>
            console.log(
              `STOPPED ${site} at ${err.url} (HTTP 429) while reading ${plant.key}; rerun to resume.`,
            ),
        })),
      );
      console.log(
        `${plant.key}: ${rows.filter((r) => r.path && r.entry === (plant.entry ?? r.entry)).length} pages cached so far`,
      );
    }
  } catch (err) {
    if (err.code !== "MAX") throw err;
    stop = err;
    console.log(`STOPPED at the request cap while reading ${at}: ${err.message}. Rerun to resume.`);
  }
  const note = stop
    ? `# stopped: ${stop.message}; rerun the same command to resume\n`
    : stopped.size
      ? `# sites stopped at HTTP 429: ${[...stopped].join(", ")}; rerun later to resume\n`
      : "";
  const tsv = note + toManifestTsv(rows);
  mkdirSync(a.cache, { recursive: true });
  mkdirSync(a.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(a.cache, `manifest-${stamp}.tsv`), tsv);
  writeFileSync(join(a.out, "manifest.tsv"), tsv);
  console.log(
    `${rows.length} requests logged, ${rows.filter((r) => r.path).length} pages cached, ${fetcher.used} network requests this run. Sites the script cannot read: ${UNREADABLE.join(", ")}.`,
  );
  if (stop || stopped.size) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
