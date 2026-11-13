// SPDX-License-Identifier: AGPL-3.0-only
// helpers for scripts/fetch-sources.mjs, the no-model source-page cache for the catalogue research runs (no model, polite delays).
// Pure except fetchPlant, which writes the cache files and takes the network call (`get`) as an argument so
// tests never touch the network. The polite fetcher itself is makeFetcher.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decode,
  fold,
  hrefs,
  matchPage,
  pageHeads,
  pageTitle,
  textOf,
} from "./harvest-links-lib.mjs";

export const plantSlug = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Readable text of a page: scripts, styles, navigation, header and footer removed, one block per line. */
export function htmlToText(html) {
  const body = html
    .replace(/<(script|style|nav|header|footer|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|title|dt|dd|blockquote)\b[^>]*>/gi,
      "\n",
    );
  return decode(body.replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Genus and epithet (null for a genus-level name or a cultivar) of a scientific name, as lower-case words. */
function latin(name) {
  const w = fold(name.replace(/\(.*?\)/g, " "))
    .split(/\s+/)
    .filter((t) => t && t !== "x");
  const epithet = w[1] && /^[a-z][a-z-]+$/.test(w[1]) ? w[1] : null;
  return { genus: w[0] ?? "", epithet };
}

const uniq = (a) => [...new Set(a)];
const names = (plant) => [plant.scientificName, ...(plant.synonyms ?? [])];

const NCSU = "https://plants.ces.ncsu.edu/plants/";
const ASPCA = "https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants/";

/** Words of a path or a name, folded, for matching an address against a plant. */
const wordsOf = (s) =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const sameWord = (token, w) => token === w || token === `${w}s` || token === `${w}es`;

/**
 * The sites entries cite most (counted from `sourcesRead` of the 106 catalogue entries on 2026-11-06) whose pages
 * a plain script can read. `urls` = direct addresses tried in order until one names the plant; `searchUrl` = a
 * search page whose result links (`resultPattern`) are opened, at most `maxResults`.
 * `scientificLine` = decide from the page's "Scientific Name:" line instead of its headings.
 */
export const SOURCES = {
  ncsu: {
    id: "ncsu",
    label: "NC State Extension Gardener Plant Toolbox",
    urls: (p) =>
      uniq(
        names(p).map((n) => {
          const l = latin(n);
          return `${NCSU}${l.genus}${l.epithet ? `-${l.epithet}` : ""}/`;
        }),
      ),
  },
  aspca: {
    id: "aspca",
    label:
      "ASPCA toxic and non-toxic plants (toxicity facts only; PROTOCOL: never copy its wording)",
    scientificLine: true,
    urls: (p) =>
      uniq([
        ...(p.common ?? [])
          .filter((c) => !/[^\x00-\x7f]/.test(c))
          .map(plantSlug)
          .slice(0, 3),
        latin(p.scientificName).genus,
      ])
        .filter(Boolean)
        .map((s) => ASPCA + s),
  },
  mbg: {
    id: "mbg",
    label: "Missouri Botanical Garden Plant Finder",
    searchUrl: (p) => {
      const l = latin(p.scientificName);
      return `https://plantfinder.mobot.org/PlantFinderListResults.aspx?basic=${encodeURIComponent(
        [l.genus, l.epithet].filter(Boolean).join(" "),
      )}`;
    },
    resultPattern: /PlantFinderDetails\.aspx\?taxonid=/i,
    resultBy: "text",
    maxResults: 2,
  },
  clemson: {
    id: "clemson",
    label: "Clemson HGIC factsheets",
    searchUrl: (p) =>
      `https://hgic.clemson.edu/?s=${encodeURIComponent(
        fold((p.common ?? [])[0] ?? latin(p.scientificName).genus),
      )}`,
    resultPattern: /\/factsheet\/[^/]+\/$/,
    resultBy: "slug",
    maxResults: 2,
  },
};

/**
 * Sites cites that a script cannot read (checked by hand 2026-11-06): RHS (search and plant pages are
 * script-built, addresses carry a numeric id), Penn State Extension (no search address, no plant pattern),
 * Iowa State and UMD (articles about many plants, not one page per plant).
 */
export const UNREADABLE = [
  "www.rhs.org.uk",
  "extension.psu.edu",
  "yardandgarden.extension.iastate.edu",
  "extension.umd.edu",
];

/** Anchors {href, text} of a page, href made absolute against `base`. */
function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      u.hash = "";
      out.push({ href: u.href, text: textOf(m[2]) });
    } catch {
      /* not a url */
    }
  }
  return out;
}

/** Result links of a search page worth opening for `plant`, each once, at most `source.maxResults`. */
export function resultLinks(source, html, base, plant) {
  const out = [];
  if (source.resultBy === "text") {
    for (const a of anchors(html, base)) {
      if (!source.resultPattern.test(a.href) || out.includes(a.href)) continue;
      const m = matchPage(a.text, plant);
      if (m && (m.match === "species" || m.match === "synonym")) out.push(a.href);
    }
  } else {
    const want = uniq([
      latin(plant.scientificName).genus,
      ...(plant.common ?? []).flatMap(wordsOf).filter((w) => w.length >= 4),
    ]).filter(Boolean);
    for (const href of hrefs(html, base)) {
      if (!source.resultPattern.test(href) || out.includes(href)) continue;
      const tokens = wordsOf(new URL(href).pathname);
      if (tokens.some((t) => want.some((w) => sameWord(t, w)))) out.push(href);
    }
  }
  return out.slice(0, source.maxResults ?? 2);
}

/** Rows of the starter table (`| n | Common en / common es | *Scientific name* | ...`). */
export function parseStarterRows(md) {
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*\*([^*]+)\*\s*\|/.exec(line);
    if (!m) continue;
    const common = m[2]
      .split("/")
      .flatMap((part) => part.replace(/\(.*?\)/g, "").split(","))
      .map((c) => c.trim())
      .filter(Boolean);
    rows.push({
      row: Number(m[1]),
      key: `row-${m[1]}`,
      scientificName: m[3].trim(),
      synonyms: [],
      common,
    });
  }
  return rows;
}

/** `--plant "Sci name|Latin synonym|common name|..."`: two-word Latin items are synonyms, the rest common names. */
export function parsePlantArg(arg) {
  const [scientificName, ...rest] = arg.split("|").map((s) => s.trim());
  const isLatin = (s) => /^[A-Z][a-z]+ (x )?[a-z-]+$/.test(s);
  return {
    key: plantSlug(scientificName),
    scientificName,
    synonyms: rest.filter(isLatin),
    common: rest.filter((s) => !isLatin(s)),
  };
}

const cell = (s) =>
  String(s ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
export const MANIFEST_HEAD = [
  "row",
  "entry",
  "site",
  "URL",
  "HTTP status",
  "title",
  "bytes",
  "path",
  "match",
];

export function toManifestTsv(rows) {
  const lines = rows.map((r) =>
    [r.row, r.entry, r.site, r.url, r.status, r.title, r.bytes, r.path, r.match]
      .map(cell)
      .join("\t"),
  );
  return [MANIFEST_HEAD.join("\t"), ...lines].join("\n") + "\n";
}

/**
 * Fetch the pages of one plant from each source and cache the ones that name the plant:
 * `<cacheRoot>/<site>/<key>.html` beside `<key>.txt` (a second page of the same site gets `-2`). Returns manifest
 * rows for every request. A site stops at its first HTTP 429 (recorded in `stopped`, reported to `onStop`) and
 * is skipped for the rest of the run; any other error (the request cap) goes up to the caller.
 */
export async function fetchPlant({
  get,
  sources,
  plant,
  cacheRoot,
  stopped = new Set(),
  onStop = () => {},
}) {
  const rows = [];
  for (const source of sources) {
    if (stopped.has(source.id)) continue;
    let saved = 0;
    const base = {
      row: plant.row ?? "",
      entry: plant.entry ?? plantSlug(plant.scientificName),
      site: source.id,
    };
    let current = "";
    const fetchOne = (url) => {
      current = url;
      return get(url);
    };
    const open = async (url) => {
      const res = await fetchOne(url);
      const row = {
        ...base,
        url,
        status: res.status,
        title: "",
        bytes: 0,
        path: "",
        match: "none",
      };
      rows.push(row);
      if (res.status !== 200) return { res, row, ok: false };
      row.title = pageTitle(res.body);
      row.bytes = Buffer.byteLength(res.body);
      const line =
        source.scientificLine && /scientific names?:\s*([^\n]+)/i.exec(htmlToText(res.body));
      const m = matchPage(line ? line[1] : pageHeads(res.body), plant);
      if (!m) return { res, row, ok: false };
      row.match = m.match;
      const stem = saved++ === 0 ? plant.key : `${plant.key}-${saved}`;
      mkdirSync(join(cacheRoot, source.id), { recursive: true });
      writeFileSync(join(cacheRoot, source.id, `${stem}.html`), res.body);
      writeFileSync(join(cacheRoot, source.id, `${stem}.txt`), htmlToText(res.body) + "\n");
      row.path = `${source.id}/${stem}.html`;
      return { res, row, ok: true };
    };
    try {
      if (source.urls) {
        for (const url of source.urls(plant)) if ((await open(url)).ok) break;
      } else {
        const url = source.searchUrl(plant);
        const search = await fetchOne(url);
        rows.push({
          ...base,
          url,
          status: search.status,
          title: pageTitle(search.body),
          bytes: Buffer.byteLength(search.body),
          path: "",
          match: "search",
        });
        if (search.status === 200)
          for (const link of resultLinks(source, search.body, url, plant)) await open(link);
      }
    } catch (err) {
      if (err.code === "MAX") throw err;
      if (err.code !== "HTTP429") {
        // a certificate or connection error on one page: log it and go on with the next site
        rows.push({
          ...base,
          url: current,
          status: 0,
          title: `network error: ${err.cause?.code ?? err.message}`,
          bytes: 0,
          path: "",
          match: "none",
        });
        continue;
      }
      stopped.add(source.id);
      onStop(source.id, err);
    }
  }
  return rows;
}
