// SPDX-License-Identifier: AGPL-3.0-only
// helpers for scripts/harvest-links.mjs (no model, no dependency). Pure except makeFetcher, which
// takes the network call as an argument so tests never touch the network.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Lower case, accents removed. */
export const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m);
export const textOf = (html) =>
  decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** The page's `<title>`, every `<h1>` and the first `<h2>`, joined: where a page names its plant. */
export function pageHeads(html) {
  const body = html.replace(/<(script|style|nav)\b[\s\S]*?<\/\1>/gi, " ");
  const grab = (tag, all) => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
    const out = [];
    for (const m of body.matchAll(re)) {
      out.push(textOf(m[1]));
      if (!all) break;
    }
    return out;
  };
  return [...grab("title", false), ...grab("h1", true), ...grab("h2", false)]
    .filter(Boolean)
    .join(" | ");
}

export const pageTitle = (html) =>
  textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");

/** Absolute http(s) links of a page, fragment removed, each once. */
export function hrefs(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      u.hash = "";
      out.add(u.href);
    } catch {
      /* not a url */
    }
  }
  return [...out];
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));

/** Page urls of sitemaps (indexes followed), kept when they match `include`. */
export async function collectFromSitemaps(get, roots, include) {
  const queue = [...roots];
  const seen = new Set(queue);
  const out = new Set();
  while (queue.length) {
    const url = /** @type {string} */ (queue.shift());
    const res = await get(url);
    if (res.status !== 200) continue;
    const isIndex = /<sitemapindex/i.test(res.body);
    for (const loc of locs(res.body)) {
      if (isIndex) {
        if (!seen.has(loc)) {
          seen.add(loc);
          queue.push(loc);
        }
      } else if (include.test(loc)) out.add(loc);
    }
  }
  return [...out];
}

/** Detail-page urls found by walking index pages: `follow` links are walked once, `detail` links collected. */
export async function collectFromIndex(get, starts, follow, detail) {
  const queue = [...starts];
  const seen = new Set(queue);
  const hosts = new Set(starts.map((s) => new URL(s).host));
  const out = new Set();
  while (queue.length) {
    const url = /** @type {string} */ (queue.shift());
    const res = await get(url);
    if (res.status !== 200) continue;
    for (const link of hrefs(res.body, url)) {
      if (!hosts.has(new URL(link).host)) continue;
      if (follow.test(link) && !seen.has(link)) {
        seen.add(link);
        queue.push(link);
      }
      if (detail.test(link)) out.add(link);
    }
  }
  return [...out];
}

const words = (s) =>
  fold(s)
    .replace(/['"‘’()×]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Genus and epithet of a scientific name (epithet null for a genus-level name or a cultivar). */
function parts(name) {
  const raw = name
    .replace(/['"‘’()×]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const w = raw.filter((t) => t !== "x" && t !== "X");
  const genus = fold(w[0] ?? "");
  const e = w[1];
  const epithet = e && /^[a-z][a-z-]+$/.test(e) ? e : null;
  return { genus, epithet, label: epithet ? `${w[0]} ${e}` : (w[0] ?? name) };
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text, p) =>
  new RegExp(`(?<![a-z])${esc(p.genus)}\\s+x?\\s*${esc(p.epithet)}(?![a-z])`).test(text);
const mentionsGenus = (text, g) => new RegExp(`(?<![a-z])${esc(g)}(?![a-z])`).test(text);

/**
 * How a page's heading text names an entry: `species` (its scientific name), `synonym` (one of its
 * synonyms), `genus` (only the genus) or null. Accents and case are folded.
 */
export function matchPage(headText, entry) {
  const text = fold(headText);
  const sci = parts(entry.scientificName);
  if (sci.epithet === null) {
    // A genus-level entry only matches a page named for the genus alone ("Rosa", "Rosa pianta - Site"),
    // never one that merely contains the word ("Banana Rosa", "Rosa d'India").
    const named = text
      .split(/\s*[|\-–:]\s*/)
      .map((t) => t.replace(/\s+(pianta|piante|planta|plantas|plant)$/, "").trim());
    return named.includes(sci.genus) ? { match: "species", named: sci.label } : null;
  }
  if (mentions(text, sci)) return { match: "species", named: sci.label };
  for (const s of entry.synonyms ?? []) {
    const p = parts(s);
    if (p.epithet !== null && mentions(text, p)) return { match: "synonym", named: p.label };
  }
  if (mentionsGenus(text, sci.genus)) return { match: "genus", named: sci.label.split(" ")[0] };
  return null;
}

/** Entries whose genus (or a synonym's genus) is a word of the url path: the only pages worth opening. */
export function slugCandidates(url, entries, { needEpithet = false } = {}) {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* a bare path */
  }
  const tokens = new Set(words(decodeURIComponent(path).replace(/[-_/.]+/g, " ")));
  return entries.filter((e) =>
    [e.scientificName, ...(e.synonyms ?? [])].some((n) => {
      const p = parts(n);
      if (p.genus.length <= 2 || !tokens.has(p.genus)) return false;
      return (
        !needEpithet ||
        p.epithet === null ||
        tokens.has(fold(p.epithet).replace(/-/g, " ").split(" ")[0])
      );
    }),
  );
}

/**
 * A polite fetcher: waits `delayMs` between network requests, caches answers on disk (a cached answer costs
 * no request), stops at the first HTTP 429 (error code HTTP429, with the url) and when `max` requests are used
 * (error code MAX).
 */
export function makeFetcher({ fetchImpl, delayMs, cacheDir, userAgent, max, sleep }) {
  let used = 0;
  mkdirSync(cacheDir, { recursive: true });
  const fail = (code, url, message) => Object.assign(new Error(message), { code, url });
  return {
    get used() {
      return used;
    },
    async get(url, { method = "GET" } = {}) {
      const file = join(
        cacheDir,
        createHash("sha1").update(`${method} ${url}`).digest("hex") + ".json",
      );
      if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };
      if (used >= max) throw fail("MAX", url, `request cap ${max} reached before ${url}`);
      if (used > 0) await sleep(delayMs);
      used++;
      const res = await fetchImpl(url, {
        method,
        headers: { "user-agent": userAgent },
        redirect: "follow",
      });
      if (res.status === 429) throw fail("HTTP429", url, `HTTP 429 at ${url}`);
      const body = method === "HEAD" ? "" : await res.text();
      const out = { url, status: res.status, body };
      if (res.status < 500) writeFileSync(file, JSON.stringify(out));
      return { ...out, cached: false };
    },
  };
}

const cell = (s) =>
  String(s ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
export const TSV_HEAD = [
  "id",
  "url",
  "exact page title",
  "species named on the page",
  "match",
  "opened",
];

/** Rows in the column order of the harvest output folder. */
export function toTsv(rows) {
  const lines = rows.map((r) =>
    [r.id, r.url, r.title, r.named, r.match, r.opened].map(cell).join("\t"),
  );
  return [TSV_HEAD.join("\t"), ...lines].join("\n") + "\n";
}

/** Rows of a saved harvest TSV (either layout); `#` lines and the header are skipped. */
export function parseTsv(text) {
  const rows = [];
  let cols = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f[0] === "id") {
      cols = f;
      continue;
    }
    const col = (...names) => {
      const i = cols.findIndex((c) => names.includes(c));
      return i < 0 ? "" : (f[i] ?? "").trim();
    };
    rows.push({
      id: col("id"),
      url: col("url"),
      title: col("exact page title", "title"),
      named: col("species named on the page", "species named on page", "species_on_page"),
      match: col("match"),
      opened: col("opened"),
    });
  }
  return rows;
}

/**
 * Links to store for one entry from its harvest rows (already in site order): `species` and `synonym`
 * matches whose page was opened, species before synonym, each url once, at most `perLang` per language.
 * `describe(url)` gives {lang, publisher} or null to skip a site.
 */
export function pickLinks(rows, describe, perLang = 3) {
  const rank = { species: 0, synonym: 1 };
  const good = rows
    .filter((r) => r.opened === "yes" && r.match in rank)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank[a.r.match] - rank[b.r.match] || a.i - b.i);
  const seen = new Set();
  const count = new Map();
  const out = [];
  for (const { r } of good) {
    const d = describe(r.url);
    if (!d || seen.has(r.url) || (count.get(d.lang) ?? 0) >= perLang) continue;
    seen.add(r.url);
    count.set(d.lang, (count.get(d.lang) ?? 0) + 1);
    out.push({ url: r.url, title: r.title, publisher: d.publisher, lang: d.lang, kind: "care" });
  }
  return out;
}

/** Opened `genus` rows: pages about the genus, listed rather than stored. */
export const genusRows = (rows) => rows.filter((r) => r.match === "genus" && r.opened === "yes");
