// SPDX-License-Identifier: AGPL-3.0-only
// unit tests for the link-harvest helpers. Fixtures only; nothing here touches the network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectFromIndex,
  collectFromSitemaps,
  fold,
  hrefs,
  genusRows,
  makeFetcher,
  matchPage,
  pageHeads,
  pageTitle,
  parseTsv,
  pickLinks,
  slugCandidates,
  toTsv,
} from "./harvest-links-lib.mjs";

const fx = (n) => readFileSync(new URL(`./fixtures/harvest-links/${n}`, import.meta.url), "utf8");
const U = (p) => "https:" + "//site.test" + p;
const monstera = { id: "monstera-deliciosa", scientificName: "Monstera deliciosa", synonyms: [] };
const pothos = {
  id: "epipremnum-aureum",
  scientificName: "Epipremnum aureum",
  synonyms: ["Scindapsus aureus"],
};
const begonia = {
  id: "begonia-rex",
  scientificName: "Begonia rex-cultorum",
  synonyms: ["Begonia rex"],
};
const jade = { id: "crassula-ovata", scientificName: "Crassula ovata", synonyms: [] };

test("fold drops accents and case", () => {
  assert.equal(fold("ÁRBOL de Jadé"), "arbol de jade");
});

test("pageHeads reads title and headings, not the menu", () => {
  const h = pageHeads(fx("ficha-monstera.html"));
  assert.match(h, /Monstera deliciosa o Costilla/);
  assert.match(h, /Costilla de Adán\)/);
  assert.doesNotMatch(h, /menú/);
});

test("matchPage: species, synonym, genus, none", () => {
  assert.deepEqual(matchPage(pageHeads(fx("ficha-monstera.html")), monstera), {
    match: "species",
    named: "Monstera deliciosa",
  });
  assert.deepEqual(matchPage(pageHeads(fx("ficha-synonym.html")), pothos), {
    match: "synonym",
    named: "Scindapsus aureus",
  });
  assert.equal(matchPage(pageHeads(fx("ficha-genus.html")), begonia).match, "genus");
  assert.equal(matchPage(pageHeads(fx("ficha-monstera.html")), pothos), null);
});

test("matchPage folds accents and case", () => {
  assert.equal(matchPage(pageHeads(fx("ficha-accents.html")), jade).match, "species");
});

test("matchPage: a genus-level entry needs a page named for the genus alone", () => {
  const rosa = { id: "rosa", scientificName: "Rosa", synonyms: [] };
  assert.equal(
    matchPage("Aglaonema: cura, luce e tossicità - Piante.it | Aglaonema", {
      ...rosa,
      scientificName: "Aglaonema",
    }).match,
    "species",
  );
  assert.equal(matchPage("Rosa | Rosa", rosa).match, "species");
  assert.equal(matchPage("Rosa pianta - Piante da Giardino", rosa).match, "species");
  assert.equal(matchPage("Banana Rosa | Banana Rosa", rosa), null);
  assert.equal(matchPage("Rosa d'India | Rosa d'India", rosa), null);
  assert.equal(matchPage("Il giardino: la rosa blu", rosa), null);
});

test("pageTitle decodes entities", () => {
  assert.equal(pageTitle("<title>Rosa d&#039;India &amp; co</title>"), "Rosa d'India & co");
});

test("matchPage: the epithet is not matched inside a longer word", () => {
  assert.equal(matchPage("Monstera deliciosana", monstera).match, "genus");
});

test("slugCandidates: entries whose genus is in the url slug", () => {
  const url = U(
    "/index.php/es/plantas/535-cuidados-de-la-planta-monstera-deliciosa-o-costilla-de-adan",
  );
  assert.deepEqual(
    slugCandidates(url, [monstera, pothos]).map((e) => e.id),
    ["monstera-deliciosa"],
  );
  assert.deepEqual(slugCandidates(U("/enciclopedia/lavanda/"), [monstera]), []);
});

test("hrefs resolves relative links against the page, once each", () => {
  const l = hrefs(fx("index-page1.html"), U("/index.php/es/x"));
  assert.ok(l.includes(U("/index.php/es/contacto")));
  assert.equal(new Set(l).size, l.length);
});

test("collectFromSitemaps follows a sitemap index and filters", async () => {
  const pages = {
    [U("/sitemap.xml")]: fx("sitemap-index.xml"),
    [U("/sm-a.xml")]: fx("sitemap-a.xml"),
    [U("/sm-b.xml")]: fx("sitemap-b.xml"),
  };
  const get = async (u) => ({ status: 200, body: pages[u] });
  const out = await collectFromSitemaps(get, [U("/sitemap.xml")], /\/enciclopedia\//);
  assert.deepEqual(out.sort(), [
    U("/enciclopedia/begonia/"),
    U("/enciclopedia/monstera-deliciosa/"),
  ]);
});

test("collectFromIndex walks pagination once and collects detail links", async () => {
  const seen = [];
  const next = U("/index.php/es/plantas-por-nombre/plantas-de-la-m-a-la-r?start=");
  const pages = {
    [U("/idx")]: fx("index-page1.html"),
    [next + "9"]: fx("index-page2.html"),
    [next + "18"]: "<html></html>",
  };
  const get = async (u) => (seen.push(u), { status: 200, body: pages[u] ?? "" });
  const out = await collectFromIndex(
    get,
    [U("/idx")],
    /\?start=\d+$/,
    /\/\d+-cuidados-de-la-planta-/,
  );
  assert.equal(out.length, 3);
  assert.equal(seen.length, 3);
});

test("fetcher: waits between requests, caches, stops at 429 and at the cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-"));
  const sleeps = [];
  const calls = [];
  const respond = (status) => async (u) => (
    calls.push(u),
    { status, text: async () => "body " + u }
  );
  const mk = (status, max) =>
    makeFetcher({
      fetchImpl: respond(status),
      delayMs: 3000,
      cacheDir: dir,
      userAgent: "gg-test",
      max,
      sleep: async (ms) => sleeps.push(ms),
    });
  const f = mk(200, 2);
  assert.equal((await f.get(U("/a"))).status, 200);
  assert.equal((await f.get(U("/b"))).body, "body " + U("/b"));
  assert.deepEqual(sleeps, [3000]);
  assert.equal((await f.get(U("/a"))).cached, true);
  assert.equal(calls.length, 2);
  await assert.rejects(f.get(U("/c")), { code: "MAX" });
  const g = mk(429, 5);
  await assert.rejects(g.get(U("/d")), { code: "HTTP429", url: U("/d") });
});

test("toTsv writes the columns", () => {
  const t = toTsv([
    {
      id: "x",
      url: U("/p"),
      title: "T\tab",
      named: "Monstera deliciosa",
      match: "species",
      opened: "yes",
    },
  ]);
  const [head, row] = t.trim().split("\n");
  assert.equal(head, "id\turl\texact page title\tspecies named on the page\tmatch\topened");
  assert.equal(row.split("\t").length, 6);
});

const P = (path) => "https:" + "//www.example.test" + path;

test("parseTsv reads both saved layouts and skips # lines", () => {
  const old =
    "id\turl\texact page title\tspecies named on page\tmatch\topened\n# note\nx\t" +
    P("/a") +
    "\tT\tN\tspecies\tyes\n";
  const verde =
    "id\tsite\tlang\turl\ttitle\tspecies_on_page\tmatch\topened\nx\tv\tes\t" +
    P("/b") +
    "\tT2\tN2\tsynonym\tyes\n";
  assert.deepEqual(parseTsv(old), [
    { id: "x", url: P("/a"), title: "T", named: "N", match: "species", opened: "yes" },
  ]);
  assert.deepEqual(parseTsv(verde), [
    { id: "x", url: P("/b"), title: "T2", named: "N2", match: "synonym", opened: "yes" },
  ]);
});

test("pickLinks: species and synonym only, opened only, species first, at most 3 per language", () => {
  const row = (url, match, opened = "yes") => ({
    id: "x",
    url,
    title: "t",
    named: "n",
    match,
    opened,
  });
  const rows = [
    row(P("/g"), "genus"),
    row(P("/s1"), "synonym"),
    row(P("/s2"), "species"),
    row(P("/n"), "species", "no"),
    row(P("/s3"), "species"),
    row(P("/s4"), "species"),
    row(P("/s2"), "species"),
  ];
  const langOf = () => ({ lang: "es", publisher: "Pub" });
  const got = pickLinks(rows, langOf, 3);
  assert.deepEqual(
    got.map((l) => l.url),
    [P("/s2"), P("/s3"), P("/s4")],
  );
  assert.deepEqual(got[0], {
    url: P("/s2"),
    title: "t",
    publisher: "Pub",
    lang: "es",
    kind: "care",
  });
});

test("pickLinks: genus rows are returned apart for the review list", () => {
  const rows = [
    { id: "x", url: P("/g"), title: "t", named: "Viburnum", match: "genus", opened: "yes" },
  ];
  assert.deepEqual(
    genusRows(rows).map((r) => r.url),
    [P("/g")],
  );
});

test("slugCandidates with needEpithet: genus alone is not enough for a species-level entry", () => {
  const url = U("/12-cuidados-de-la-planta-monstera-adansonii");
  assert.equal(slugCandidates(url, [monstera]).length, 1);
  assert.equal(slugCandidates(url, [monstera], { needEpithet: true }).length, 0);
  const ok = U("/12-cuidados-de-la-planta-monstera-deliciosa");
  assert.equal(slugCandidates(ok, [monstera], { needEpithet: true }).length, 1);
  const aglaonema = { id: "aglaonema", scientificName: "Aglaonema", synonyms: [] };
  assert.equal(slugCandidates(U("/x/aglaonema"), [aglaonema], { needEpithet: true }).length, 1);
  assert.equal(
    slugCandidates(U("/x/scindapsus-aureus"), [pothos], { needEpithet: true }).length,
    1,
  );
});
