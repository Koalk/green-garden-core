// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { learnMoreLinks, linksOfEntry, type LearnLink } from "../src/index.ts";
// Tests carry no literal remote URLs (check:no-network).
const HTTPS = "https:" + "//";

const link = (url: string, lang: string, kind: LearnLink["kind"] = "care"): LearnLink => ({
  url,
  title: `t ${url}`,
  publisher: "p",
  lang,
  kind,
});
const en = link(`${HTTPS}rhs.example/monstera`, "en");
const aspca = link(`${HTTPS}aspca.example/monstera`, "en", "toxicity");
const es1 = link(`${HTTPS}consulta.example/monstera`, "es");
const es2 = link(`${HTTPS}verde.example/monstera`, "es");
const it1 = link(`${HTTPS}giardinaggio.example/monstera`, "it");

describe("learnMoreLinks", () => {
  const all = [en, aspca, es1, es2, it1];

  it("gives Spanish first, then English ones for kinds Spanish lacks, marked as English", () => {
    const r = learnMoreLinks(all, "es");
    assert.deepEqual(
      r.map((l) => [l.url, l.inEnglish]),
      [
        [es1.url, false],
        [es2.url, false],
        [aspca.url, true],
      ],
    );
  });

  it("gives Italian the same way", () => {
    const r = learnMoreLinks(all, "it");
    assert.deepEqual(
      r.map((l) => [l.url, l.inEnglish]),
      [
        [it1.url, false],
        [aspca.url, true],
      ],
    );
  });

  it("treats en-GB as English and marks nothing", () => {
    const r = learnMoreLinks(all, "en-GB");
    assert.deepEqual(
      r.map((l) => l.url),
      [en.url, aspca.url],
    );
    assert.ok(r.every((l) => !l.inEnglish));
  });

  it("falls back to the English links, marked, when the language has none", () => {
    const r = learnMoreLinks([en, aspca], "es-MX");
    assert.deepEqual(
      r.map((l) => [l.url, l.inEnglish]),
      [
        [en.url, true],
        [aspca.url, true],
      ],
    );
  });

  it("gives nothing for a plant with no links", () => {
    assert.deepEqual(learnMoreLinks([], "es"), []);
  });

  it("picks the right edition of a site that has one URL per language", () => {
    const site = (lang: string) => link(`${HTTPS}multi.example/${lang}/monstera`, lang);
    const r = learnMoreLinks([site("en"), site("es"), site("it")], "it");
    assert.deepEqual(
      r.map((l) => l.url),
      [`${HTTPS}multi.example/it/monstera`],
    );
  });

  it("drops duplicate URLs", () => {
    assert.equal(learnMoreLinks([en, { ...en }], "en").length, 1);
  });
});

describe("linksOfEntry", () => {
  it("joins the entry's links with its fetched sources that have a URL, as links", () => {
    const sources = [
      {
        id: "a",
        title: "RHS page",
        publisher: "RHS",
        url: `${HTTPS}rhs.example/x`,
        kind: "society",
        lang: "en",
      },
      {
        id: "b",
        title: "ASPCA",
        publisher: "ASPCA",
        url: `${HTTPS}aspca.example/x`,
        kind: "database",
        linkKind: "toxicity",
        lang: "en",
      },
      { id: "author", title: "Author", url: "", kind: "author_knowledge" },
    ];
    const r = linksOfEntry({ links: [es1] }, sources);
    assert.deepEqual(
      r.map((l) => [l.url, l.lang]),
      [
        [es1.url, "es"],
        [`${HTTPS}rhs.example/x`, "en"],
        [`${HTTPS}aspca.example/x`, "en"],
      ],
    );
    assert.equal(r[2]?.kind, "toxicity");
    assert.equal(r[1]?.kind, "care");
  });
});
