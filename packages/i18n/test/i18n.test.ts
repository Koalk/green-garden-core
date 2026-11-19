// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCALES,
  createTranslator,
  firstDayOfWeek,
  formatDate,
  formatList,
  getLocale,
  negotiateLocale,
  placeholdersOf,
  setLocale,
  t,
  weekdayName,
  type Catalogues,
} from "../src/index.ts";
import enGB from "../src/locales/en-GB.json" with { type: "json" };
import es from "../src/locales/es.json" with { type: "json" };
import it_ from "../src/locales/it.json" with { type: "json" };

const cats: Catalogues = {
  "en-GB": {
    "a.one": "One {n, plural, one {# thing} other {# things}}",
    "only.en": "English only",
  },
  es: { "a.one": "Uno {n, plural, one {# cosa} other {# cosas}}" },
};

describe("translator", () => {
  it("looks the key up in the requested locale", () => {
    const tr = createTranslator("es", cats);
    assert.equal(tr("a.one", { n: 2 }), "Uno 2 cosas");
  });

  it("falls back per string to en-GB, not per file", () => {
    const tr = createTranslator("es", cats);
    assert.equal(tr("only.en"), "English only");
  });

  it("regional tags fall back to the language first", () => {
    const tr = createTranslator("es-MX", cats);
    assert.equal(tr("a.one", { n: 1 }), "Uno 1 cosa");
  });

  it("a key in no catalogue shows the key, visibly", () => {
    const tr = createTranslator("es", cats);
    assert.equal(tr("nope.nothing"), "nope.nothing");
  });

  it("a broken translation falls back to the English string", () => {
    const broken: Catalogues = {
      "en-GB": { k: "Hello {name}" },
      es: { k: "Hola {name, plural, one {x}" },
    };
    assert.equal(createTranslator("es", broken)("k", { name: "A" }), "Hello A");
  });

  it("the global t() follows setLocale and lang is reported", () => {
    setLocale("it");
    assert.equal(getLocale(), "it");
    assert.equal(t("common.save"), it_["common.save"]);
    setLocale("en-GB");
    assert.equal(t("common.save"), enGB["common.save"]);
  });
});

describe("shipped catalogues", () => {
  it("every es and it key exists in en-GB with the same placeholders", () => {
    for (const [name, cat] of [
      ["es", es],
      ["it", it_],
    ] as const) {
      for (const [k, v] of Object.entries(cat)) {
        const base = (enGB as Record<string, string>)[k];
        assert.ok(base !== undefined, `${name}: unknown key ${k}`);
        assert.deepEqual(placeholdersOf(v), placeholdersOf(base), `${name}: ${k}`);
      }
    }
  });

  it("es and it cover every en-GB key (drafts are complete)", () => {
    for (const [name, cat] of [
      ["es", es],
      ["it", it_],
    ] as const)
      assert.deepEqual(
        Object.keys(enGB).filter((k) => !(k in cat) && !k.endsWith(".us")),
        [],
        name,
      );
  });

  it("LOCALES lists en-GB first and marks the drafts as machine translated", () => {
    assert.equal(LOCALES[0]?.tag, "en-GB");
    assert.equal(LOCALES[0].machine, false);
    assert.deepEqual(
      LOCALES.filter((l) => l.machine).map((l) => l.tag),
      ["es", "it"],
    );
  });
});

describe("locale negotiation", () => {
  it("picks the first requested language we ship, ignoring region", () => {
    assert.equal(negotiateLocale(["es-ES", "en"]), "es");
    assert.equal(negotiateLocale(["fr", "it-IT"]), "it");
  });
  it("en-US and en-GB both give en-GB; unknown gives en-GB", () => {
    assert.equal(negotiateLocale(["en-US"]), "en-GB");
    assert.equal(negotiateLocale(["ja"]), "en-GB");
    assert.equal(negotiateLocale([]), "en-GB");
  });
});

describe("formatting", () => {
  it("formats an ISO date for the locale, never by timezone", () => {
    assert.equal(
      formatDate("2026-11-02", "en-GB", { weekday: "short", day: "numeric", month: "short" }),
      "Mon 2 Nov",
    );
    assert.equal(formatDate("2026-11-02", "es", { weekday: "long" }), "lunes");
  });
  it("lists with the locale's conjunction", () => {
    assert.equal(formatList(["a", "b", "c"], "en-GB"), "a, b and c");
    assert.equal(formatList(["a", "b", "c"], "es"), "a, b y c");
  });
  it("lists and week start work without Intl.ListFormat and Intl.Locale (Hermes)", () => {
    const intl = Intl as unknown as { ListFormat?: unknown; Locale?: unknown };
    const saved = { l: intl.ListFormat, c: intl.Locale };
    delete intl.ListFormat;
    delete intl.Locale;
    try {
      assert.equal(formatList(["a", "b", "c"], "en-GB"), "a, b and c");
      assert.equal(formatList(["a", "b"], "en-GB"), "a and b");
      assert.equal(formatList(["a"], "en-GB"), "a");
      assert.equal(formatList([], "en-GB"), "");
      assert.equal(formatList(["a", "b", "c"], "es"), "a, b y c");
      assert.equal(formatList(["a", "iris"], "es"), "a e iris");
      assert.equal(formatList(["a", "b", "c"], "it"), "a, b e c");
      for (const l of ["en-GB", "es", "it"]) assert.equal(firstDayOfWeek(l), 1);
      assert.equal(firstDayOfWeek("en-US"), 0);
    } finally {
      intl.ListFormat = saved.l;
      intl.Locale = saved.c;
    }
  });
  it("weekday names by index (0 = Sunday), short and long", () => {
    assert.equal(weekdayName(1, "en-GB", "short"), "Mon");
    assert.equal(weekdayName(0, "it", "long"), "domenica");
  });
  it("week starts on Monday for the shipped locales", () => {
    for (const l of ["en-GB", "es", "it"]) assert.equal(firstDayOfWeek(l), 1);
    assert.equal(firstDayOfWeek("en-US"), 0);
  });
});
