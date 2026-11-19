// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCatalogues, newLocaleFile, pluralKeysOf, usedKeysIn } from "../src/check.ts";

const meta = {
  "en-GB": { name: "English", machine: false },
  es: { name: "Español", machine: true },
  fr: { name: "Français", machine: false },
};
const en = {
  "a.title": "Title",
  "a.count": "{n, plural, one {# plant} other {# plants}}",
  "a.hello": "Hello {name}",
};
const used = new Set(["a.title", "a.count", "a.hello"]);
const usage = (literals: Set<string>, asked: Set<string> = literals) => ({
  literals,
  prefixes: new Set<string>(),
  asked,
});

describe("i18n:check", () => {
  it("passes a complete, consistent set", () => {
    const r = checkCatalogues({
      catalogues: {
        "en-GB": en,
        es: {
          "a.title": "Título",
          "a.count": "{n, plural, one {# planta} other {# plantas}}",
          "a.hello": "Hola {name}",
        },
        fr: {
          "a.title": "Titre",
          "a.count": "{n, plural, one {# plante} other {# plantes}}",
          "a.hello": "Salut {name}",
        },
      },
      meta,
      usage: usage(used),
    });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });

  it("errors on bad ICU syntax, changed placeholders and unknown keys", () => {
    const r = checkCatalogues({
      catalogues: {
        "en-GB": en,
        es: {
          "a.title": "T",
          "a.count": "{n, plural, one {x}",
          "a.hello": "Hola {nombre}",
          "z.extra": "x",
        },
        fr: { ...en },
      },
      meta,
      usage: usage(used),
    });
    assert.ok(
      r.errors.some((e) => e.includes("es") && e.includes("a.count") && e.includes("syntax")),
    );
    assert.ok(r.errors.some((e) => e.includes("a.hello") && e.includes("placeholders")));
    assert.ok(r.errors.some((e) => e.includes("z.extra") && e.includes("unknown key")));
  });

  it("missing keys: a warning for a machine draft, an error for a reviewed language", () => {
    const r = checkCatalogues({
      catalogues: { "en-GB": en, es: { "a.title": "T" }, fr: { "a.title": "T" } },
      meta,
      usage: usage(used),
    });
    assert.ok(r.warnings.some((w) => w.startsWith("es") && w.includes("a.count")));
    assert.ok(r.errors.some((e) => e.startsWith("fr") && e.includes("a.count")));
    assert.ok(!r.errors.some((e) => e.startsWith("es")));
  });

  it("errors on plural categories the language does not have", () => {
    const r = checkCatalogues({
      catalogues: {
        "en-GB": en,
        es: { ...en, "a.count": "{n, plural, one {# a} few {# b} other {# c}}" },
        fr: { ...en },
      },
      meta,
      usage: usage(used),
    });
    assert.ok(
      r.errors.some((e) => e.includes("es") && e.includes("few")),
      r.errors.join("|"),
    );
  });

  it("errors on keys nobody uses and on keys the code asks for but en-GB lacks", () => {
    const r = checkCatalogues({
      catalogues: { "en-GB": { ...en, "a.old": "Old" }, es: {}, fr: { ...en, "a.old": "x" } },
      meta,
      usage: usage(used, new Set([...used, "a.missing"])),
    });
    assert.ok(r.errors.some((e) => e.includes("a.old") && e.includes("unused")));
    assert.ok(r.errors.some((e) => e.includes("a.missing") && e.includes("not in en-GB")));
  });

  it("errors on a locale without a meta entry", () => {
    const r = checkCatalogues({
      catalogues: { "en-GB": en, de: en },
      meta: { "en-GB": meta["en-GB"] },
      usage: usage(used),
    });
    assert.ok(r.errors.some((e) => e.includes("de") && e.includes("meta")));
  });
});

describe("source scanning", () => {
  it("finds literal keys and dynamic prefixes", () => {
    const src = 't("a.title"); t(`outcome.${o}`); other("not.a.key.here") // "common.save"';
    const { literals, prefixes } = usedKeysIn(src);
    assert.ok(literals.has("a.title"));
    assert.ok(literals.has("common.save"));
    assert.deepEqual([...prefixes], ["outcome."]);
  });
});

describe("pluralKeysOf", () => {
  it("lists the case selectors of every plural, nested ones included", () => {
    assert.deepEqual(
      pluralKeysOf("{n, plural, =0 {none} one {#} other {{m, plural, few {x} other {y}}}}"),
      ["=0", "one", "other", "few", "other"],
    );
  });
});

describe("i18n:new", () => {
  it("copies the English text so a new file is complete from the start", () => {
    const f = newLocaleFile(en);
    assert.deepEqual(f, en);
    assert.notEqual(f, en);
  });
});

describe("regional variant keys", () => {
  it("an .us variant in en-GB does not have to exist in other languages", () => {
    const r = checkCatalogues({
      catalogues: { "en-GB": { "a.t": "Dump", "a.t.us": "Trash" }, es: { "a.t": "Vaciar" } },
      meta: {
        "en-GB": { name: "English", machine: false },
        es: { name: "Español", machine: true },
      },
      usage: { literals: new Set(["a.t", "a.t.us"]), prefixes: new Set(), asked: new Set(["a.t"]) },
    });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });
});
