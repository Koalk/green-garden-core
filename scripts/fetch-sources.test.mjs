// SPDX-License-Identifier: AGPL-3.0-only
// unit tests for the source-page cache helpers. Saved HTML fixtures only; nothing here touches the network.
// check-no-network: fixture-urls
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SOURCES,
  fetchPlant,
  htmlToText,
  parsePlantArg,
  parseStarterRows,
  plantSlug,
  resultLinks,
  toManifestTsv,
} from "./fetch-sources-lib.mjs";

const fx = (n) => readFileSync(new URL(`./fixtures/fetch-sources/${n}`, import.meta.url), "utf8");
const lantana = {
  key: "row-88",
  scientificName: "Lantana camara",
  synonyms: [],
  common: ["Lantana"],
};
const tulip = {
  key: "row-87",
  scientificName: "Tulipa gesneriana",
  synonyms: [],
  common: ["Tulip"],
};
const calamondin = {
  key: "row-232",
  scientificName: "Citrus x microcarpa",
  synonyms: ["Citrus japonica"],
  common: ["calamondin", "kumquat"],
};
const ASPCA = "https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants/";

test("plantSlug: lower case, accents folded, one dash between words", () => {
  assert.equal(plantSlug("Citrus x microcarpa"), "citrus-x-microcarpa");
  assert.equal(plantSlug("Clemátide  (hybrids)"), "clematide-hybrids");
});

test("htmlToText drops scripts, nav, header and footer, decodes entities and keeps line breaks", () => {
  const t = htmlToText(fx("ncsu-lantana.html"));
  assert.match(t, /Lantana camara/);
  assert.match(t, /full sun & part shade/);
  assert.doesNotMatch(t, /var x/);
  assert.doesNotMatch(t, /Copyright/);
  assert.doesNotMatch(t, /<[a-z]/);
  assert.ok(t.split("\n").length > 2);
});

test("URL building: NC State by scientific name and synonyms, ASPCA by common name and genus", () => {
  assert.deepEqual(SOURCES.ncsu.urls(calamondin), [
    "https://plants.ces.ncsu.edu/plants/citrus-microcarpa/",
    "https://plants.ces.ncsu.edu/plants/citrus-japonica/",
  ]);
  assert.deepEqual(SOURCES.aspca.urls(calamondin), [
    ASPCA + "calamondin",
    ASPCA + "kumquat",
    ASPCA + "citrus",
  ]);
  assert.equal(
    SOURCES.mbg.searchUrl(lantana),
    "https://plantfinder.mobot.org/PlantFinderListResults.aspx?basic=lantana%20camara",
  );
  assert.equal(SOURCES.clemson.searchUrl(tulip), "https://hgic.clemson.edu/?s=tulip");
});

test("a genus-level scientific name gives no epithet in the NC State address", () => {
  const clem = { key: "r", scientificName: "Clematis (hybrids)", synonyms: [], common: [] };
  assert.deepEqual(SOURCES.ncsu.urls(clem), ["https://plants.ces.ncsu.edu/plants/clematis/"]);
});

test("resultLinks: MBG results are chosen by the name in the link text", () => {
  const got = resultLinks(
    SOURCES.mbg,
    fx("mbg-list.html"),
    "https://plantfinder.mobot.org/x",
    lantana,
  );
  assert.deepEqual(got, [
    "https://plantfinder.mobot.org/PlantFinderDetails.aspx?taxonid=287443&isprofile=0&basic=lantana%20camara",
  ]);
});

test("resultLinks: Clemson results are factsheets whose address names the plant, each once", () => {
  const got = resultLinks(
    SOURCES.clemson,
    fx("clemson-search.html"),
    "https://hgic.clemson.edu/?s=tulip",
    tulip,
  );
  assert.deepEqual(got, ["https://hgic.clemson.edu/factsheet/tulips/"]);
});

test("parseStarterRows reads rows of the 01c table with common names in both languages", () => {
  const md = [
    "| 87 | Tulip / tulipán | *Tulipa gesneriana* | UK3 UK8 (2) | accepted |",
    "| 90 | Clematis / clemátide | *Clematis (hybrids)* | UK3 ES3 (2) | genus accepted |",
    "| 232 | Kumquat and calamondin / kumquat, calamondín | *Citrus japonica* | EES6 (2) | accepted |",
    "| not a row |",
  ].join("\n");
  const rows = parseStarterRows(md);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    row: 87,
    key: "row-87",
    scientificName: "Tulipa gesneriana",
    synonyms: [],
    common: ["Tulip", "tulipán"],
  });
  assert.equal(rows[1].scientificName, "Clematis (hybrids)");
  assert.deepEqual(rows[2].common, ["Kumquat and calamondin", "kumquat", "calamondín"]);
});

test("parsePlantArg: first item the scientific name, two-word latin items synonyms, the rest common names", () => {
  assert.deepEqual(parsePlantArg("Citrus x microcarpa|Citrus japonica|calamondin|kumquat"), {
    key: "citrus-x-microcarpa",
    scientificName: "Citrus x microcarpa",
    synonyms: ["Citrus japonica"],
    common: ["calamondin", "kumquat"],
  });
});

const respond = (map) => async (url) => {
  if (!(url in map)) return { url, status: 404, body: "" };
  return { url, status: 200, body: map[url] };
};

test("fetchPlant caches a matching page as .html and .txt and writes manifest rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const get = respond({
    "https://plants.ces.ncsu.edu/plants/lantana-camara/": fx("ncsu-lantana.html"),
  });
  const rows = await fetchPlant({ get, sources: [SOURCES.ncsu], plant: lantana, cacheRoot: dir });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].site, "ncsu");
  assert.equal(rows[0].status, 200);
  assert.equal(rows[0].match, "species");
  assert.match(rows[0].title, /^Lantana camara/);
  assert.equal(rows[0].path, "ncsu/row-88.html");
  assert.ok(existsSync(join(dir, "ncsu", "row-88.html")));
  assert.match(readFileSync(join(dir, "ncsu", "row-88.txt"), "utf8"), /drought & heat tolerant/);
});

test("fetchPlant does not cache a page that names another plant (ASPCA tulip page for lantana)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const get = respond({ [ASPCA + "lantana"]: fx("aspca-unrelated.html") });
  const rows = await fetchPlant({ get, sources: [SOURCES.aspca], plant: lantana, cacheRoot: dir });
  assert.equal(rows[0].match, "none");
  assert.equal(rows[0].path, "");
  assert.ok(!existsSync(join(dir, "aspca", "row-88.html")));
});

test("fetchPlant: ASPCA match comes from the Scientific Name line and stops after the first hit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    return { url, status: 200, body: fx("aspca-lantana.html") };
  };
  const rows = await fetchPlant({ get, sources: [SOURCES.aspca], plant: lantana, cacheRoot: dir });
  assert.deepEqual(asked, [ASPCA + "lantana"]);
  assert.equal(rows[0].match, "species");
});

test("fetchPlant follows a search result and records both the search and the page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const detail =
    "https://plantfinder.mobot.org/PlantFinderDetails.aspx?taxonid=287443&isprofile=0&basic=lantana%20camara";
  const get = respond({
    [SOURCES.mbg.searchUrl(lantana)]: fx("mbg-list.html"),
    [detail]:
      "<html><head><title>Lantana camara - Plant Finder</title></head><body><h1>Lantana camara</h1><p>Full sun</p></body></html>",
  });
  const rows = await fetchPlant({ get, sources: [SOURCES.mbg], plant: lantana, cacheRoot: dir });
  assert.deepEqual(
    rows.map((r) => r.url),
    [SOURCES.mbg.searchUrl(lantana), detail],
  );
  assert.equal(rows[0].path, "");
  assert.equal(rows[1].match, "species");
  assert.ok(existsSync(join(dir, "mbg", "row-88.txt")));
});

test("fetchPlant: a 429 stops that site, reports where, and keeps the rows so far", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const get = async (url) => {
    if (url.includes("ncsu")) return { url, status: 200, body: fx("ncsu-lantana.html") };
    throw Object.assign(new Error(`HTTP 429 at ${url}`), { code: "HTTP429", url });
  };
  const stops = [];
  const stopped = new Set();
  const rows = await fetchPlant({
    get,
    sources: [SOURCES.ncsu, SOURCES.aspca],
    plant: lantana,
    cacheRoot: dir,
    stopped,
    onStop: (site, err) => stops.push([site, err.url]),
  });
  assert.equal(rows.length, 1);
  assert.equal(stops.length, 1);
  assert.equal(stops[0][0], "aspca");
  assert.match(stops[0][1], /aspca\.org/);
  assert.ok(stopped.has("aspca"));
});

test("fetchPlant skips a site that already hit 429 earlier in the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  let calls = 0;
  const get = async (url) => {
    calls++;
    return { url, status: 404, body: "" };
  };
  await fetchPlant({
    get,
    sources: [SOURCES.ncsu],
    plant: lantana,
    cacheRoot: dir,
    stopped: new Set(["ncsu"]),
  });
  assert.equal(calls, 0);
});

test("toManifestTsv has the columns and one line per row", () => {
  const tsv = toManifestTsv([
    {
      row: "88",
      entry: "lantana-camara",
      site: "ncsu",
      url: "https://x.test/a",
      status: 200,
      title: "T\tab",
      bytes: 12,
      path: "ncsu/row-88.html",
      match: "species",
    },
  ]);
  const [head, line] = tsv.trim().split("\n");
  assert.equal(head, "row\tentry\tsite\tURL\tHTTP status\ttitle\tbytes\tpath\tmatch");
  assert.equal(
    line,
    "88\tlantana-camara\tncsu\thttps://x.test/a\t200\tT ab\t12\tncsu/row-88.html\tspecies",
  );
});

test("fetchPlant: a network error (certificate, reset) is logged as status 0 and the run goes on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s196-"));
  const get = async (url) => {
    if (url.includes("mobot"))
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
      });
    return { url, status: 200, body: fx("ncsu-lantana.html") };
  };
  const rows = await fetchPlant({
    get,
    sources: [SOURCES.mbg, SOURCES.ncsu],
    plant: lantana,
    cacheRoot: dir,
  });
  assert.equal(rows[0].site, "mbg");
  assert.equal(rows[0].status, 0);
  assert.match(rows[0].title, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
  assert.equal(rows[1].site, "ncsu");
  assert.equal(rows[1].match, "species");
});
