// SPDX-License-Identifier: AGPL-3.0-only
// "learn more" link harvest, no model (no model, polite delays). For one 01j site: discover its plant pages from
// sitemaps or index pages, open each page that could name a catalogue entry once, and write the harvest TSV
// (--out, default .cache/link-harvest/). One request every 3 seconds or slower, a cache outside git, stop at the first
// HTTP 429 and say where to resume (rerun the same command: cached pages cost nothing).
//
//   node scripts/harvest-links.mjs --site consultaplantas [--max 300] [--delay 3000] [--ids a,b] [--discover]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  collectFromIndex,
  collectFromSitemaps,
  makeFetcher,
  matchPage,
  pageHeads,
  pageTitle,
  slugCandidates,
  toTsv,
} from "./harvest-links-lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..");
const USER_AGENT =
  "green-garden-link-harvest/0.1 (open-source plant-care app; contact: repository owner)";
const never = /(?!)/;

const cp = "https://www.consultaplantas.com/index.php/es/plantas-por-nombre/";
/** Sites of 01j. `lang` is the page language; `publisher` goes in the catalogue link. */
export const SITES = {
  consultaplantas: {
    lang: "es",
    publisher: "Consulta Plantas",
    starts: ["a-a-la-c", "d-a-la-l", "m-a-la-r", "s-a-la-z"].map((r) => `${cp}plantas-de-la-${r}`),
    follow: /\/plantas-de-la-[a-z-]+\?start=\d+$/,
    detail: /\/\d+-cuidados-de-la-planta-[^/?]+$/,
  },
  "ass-agir": {
    lang: "it",
    publisher: "Ass-Agir (L'Angolo del Botanico)",
    starts: ["https://www.ass-agir.it/langolo-del-botanico/"],
    follow: never,
    detail: /\/Scheda-n[^/]*\.pdf$/i,
    pdf: true,
  },
  piante: {
    lang: "it",
    publisher: "Piante.it",
    // Plant pages are posts at the site root (/aloe/), listed in the post sitemap (checked 2026-11-06).
    sitemaps: ["https://www.piante.it/post-sitemap.xml"],
    include: /^https:\/\/www\.piante\.it\/[^/]+\/$/,
    // Articles have long slugs ("le-proprieta-e-i-benefici-dell-aloe-vera"); plant pages are 1 to 3 words.
    maxSlugWords: 3,
  },
};

const lastSlug = (u) => new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";

/** Catalogue entries as {id, scientificName, synonyms}. */
export function readEntries(dir) {
  const out = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const doc = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const e of doc.entries ?? []) {
      out.push({
        id: e.id,
        scientificName: e.taxon?.scientificName ?? e.id,
        synonyms: e.names?.synonyms ?? [],
      });
    }
  }
  return out;
}

async function main() {
  const { values: a } = parseArgs({
    options: {
      site: { type: "string" },
      max: { type: "string", default: "300" },
      delay: { type: "string", default: "3000" },
      ids: { type: "string" },
      entries: { type: "string", default: join(repo, "catalogue-draft") },
      cache: { type: "string", default: join(repo, "..", ".cache", "gg-links") },
      out: { type: "string", default: join(repo, ".cache", "link-harvest") },
      discover: { type: "boolean", default: false },
      // also open pages whose address names only an entry's genus (they can only give `genus` rows)
      "genus-pages": { type: "boolean", default: false },
    },
  });
  const site = SITES[a.site ?? ""];
  if (!site) {
    console.error(`--site is one of: ${Object.keys(SITES).join(", ")}`);
    process.exit(2);
  }
  const wanted = a.ids ? new Set(a.ids.split(",")) : null;
  const entries = readEntries(a.entries).filter((e) => !wanted || wanted.has(e.id));
  const fetcher = makeFetcher({
    fetchImpl: fetch,
    delayMs: Math.max(3000, Number(a.delay)),
    cacheDir: join(a.cache, a.site),
    userAgent: USER_AGENT,
    max: Number(a.max),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const rows = [];
  const todo = { n: 0, done: 0 };
  let stop = null;
  try {
    const urls = site.sitemaps
      ? await collectFromSitemaps(fetcher.get, site.sitemaps, site.include)
      : await collectFromIndex(fetcher.get, site.starts, site.follow, site.detail);
    const candidates = urls
      .map((u) => u.replace(/^http:/, "https:")) // the catalogue validator wants https
      .filter((u) => !site.maxSlugWords || lastSlug(u).split("-").length <= site.maxSlugWords)
      .map((url) => ({
        url,
        who: slugCandidates(url, entries, { needEpithet: !a["genus-pages"] }),
      }))
      .filter((c) => c.who.length > 0);
    todo.n = candidates.length;
    console.log(
      `${a.site}: ${urls.length} plant pages found, ${candidates.length} whose address names an entry's genus`,
    );
    if (a.discover) return;
    for (const c of candidates) {
      if (site.pdf) {
        const head = await fetcher.get(c.url, { method: "HEAD" });
        const name = decodeURIComponent(basename(c.url))
          .replace(/\.pdf$/i, "")
          .replace(/[-_.]+/g, " ")
          .replace(/^scheda n\s*\d+\s*/i, "");
        for (const e of c.who) {
          const m = matchPage(name, e);
          if (m)
            rows.push({
              id: e.id,
              url: c.url,
              title: name,
              named: m.named,
              match: m.match,
              opened: head.status === 200 ? "yes" : "no",
            });
        }
      } else {
        const page = await fetcher.get(c.url);
        if (page.status !== 200) continue;
        const heads = pageHeads(page.body);
        for (const e of c.who) {
          const m = matchPage(heads, e);
          if (m)
            rows.push({
              id: e.id,
              url: c.url,
              title: pageTitle(page.body),
              named: m.named,
              match: m.match,
              opened: "yes",
            });
        }
      }
      todo.done++;
    }
  } catch (err) {
    if (err.code !== "HTTP429" && err.code !== "MAX") throw err;
    stop = err;
  }
  if (a.discover) return;
  mkdirSync(a.out, { recursive: true });
  const file = join(a.out, `links-${a.site}-s195.tsv`);
  const note = stop
    ? `# stopped: ${stop.message}; ${todo.done} of ${todo.n} candidate pages read; rerun the same command to resume (pages read are cached)\n`
    : `# complete: ${todo.done} of ${todo.n} candidate pages read, ${fetcher.used} requests this run\n`;
  writeFileSync(file, note + toTsv(rows));
  console.log(`${rows.length} rows -> ${file}`);
  if (stop) {
    console.log(
      `STOPPED at ${stop.url} (${stop.code}). ${todo.done} of ${todo.n} pages read. Rerun to resume.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
