// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMessage, placeholdersOf } from "../src/index.ts";

describe("ICU message subset", () => {
  it("fills plain arguments", () => {
    assert.equal(formatMessage("Hello {name}!", { name: "Monty" }, "en-GB"), "Hello Monty!");
  });

  it("plural en: one and other, # is the number", () => {
    const m = "{n, plural, one {# day} other {# days}}";
    assert.equal(formatMessage(m, { n: 1 }, "en-GB"), "1 day");
    assert.equal(formatMessage(m, { n: 3 }, "en-GB"), "3 days");
    assert.equal(formatMessage(m, { n: 0 }, "en-GB"), "0 days");
  });

  it("plural es and it use their own categories", () => {
    const m = "{n, plural, one {# día} other {# días}}";
    assert.equal(formatMessage(m, { n: 1 }, "es"), "1 día");
    assert.equal(formatMessage(m, { n: 2 }, "es"), "2 días");
    const i = "{n, plural, one {# giorno} other {# giorni}}";
    assert.equal(formatMessage(i, { n: 1 }, "it"), "1 giorno");
    assert.equal(formatMessage(i, { n: 5 }, "it"), "5 giorni");
  });

  it("exact =0 beats the category", () => {
    const m = "{n, plural, =0 {none} one {# plant} other {# plants}}";
    assert.equal(formatMessage(m, { n: 0 }, "en-GB"), "none");
    assert.equal(formatMessage(m, { n: 1 }, "en-GB"), "1 plant");
  });

  it("falls back to other when the category is missing", () => {
    assert.equal(formatMessage("{n, plural, other {# x}}", { n: 1 }, "en-GB"), "1 x");
  });

  it("select picks the case, other is the default", () => {
    const m = "{k, select, a {Alpha} b {Beta} other {Other}}";
    assert.equal(formatMessage(m, { k: "b" }, "en-GB"), "Beta");
    assert.equal(formatMessage(m, { k: "zzz" }, "en-GB"), "Other");
  });

  it("nests arguments inside plural branches", () => {
    const m = "{n, plural, one {{who} waters # plant} other {{who} waters # plants}}";
    assert.equal(formatMessage(m, { n: 2, who: "Ana" }, "en-GB"), "Ana waters 2 plants");
  });

  it("apostrophes quote braces; a lone apostrophe stays", () => {
    assert.equal(formatMessage("Don't water '{'x'}'", {}, "en-GB"), "Don't water {x}");
  });

  it("formats numbers per locale", () => {
    assert.equal(formatMessage("{n, number}", { n: 1234.5 }, "en-GB"), "1,234.5");
    assert.equal(formatMessage("{n, number}", { n: 1234.5 }, "it"), "1234,5");
  });

  it("a missing argument is left visible, not swallowed", () => {
    assert.equal(formatMessage("Hi {name}", {}, "en-GB"), "Hi {name}");
  });

  it("lists the placeholders used, nested ones included, for the translation check", () => {
    assert.deepEqual(
      placeholdersOf("{n, plural, one {{who} has # plant} other {{who} has # plants}} in {room}"),
      ["n", "room", "who"],
    );
    assert.deepEqual(placeholdersOf("no arguments"), []);
  });

  it("throws on broken syntax so the check script can report it", () => {
    assert.throws(() => formatMessage("{n, plural, one {x}", { n: 1 }, "en-GB"));
    assert.throws(() => placeholdersOf("{unclosed"));
  });
});

describe("plurals without Intl.PluralRules (Hermes on Android)", () => {
  const withoutPluralRules = (run: () => void): void => {
    const intl = Intl as unknown as { PluralRules?: unknown };
    const saved = intl.PluralRules;
    delete intl.PluralRules;
    try {
      run();
    } finally {
      intl.PluralRules = saved;
    }
  };

  it("en, es and it still pick one and other", () => {
    withoutPluralRules(() => {
      const m = "{n, plural, one {# plant} other {# plants}}";
      assert.equal(formatMessage(m, { n: 1 }, "en-GB"), "1 plant");
      assert.equal(formatMessage(m, { n: 2 }, "en-GB"), "2 plants");
      assert.equal(formatMessage(m, { n: 0 }, "en-GB"), "0 plants");
      assert.equal(formatMessage(m, { n: 1.5 }, "en-GB"), "1.5 plants");
      assert.equal(formatMessage(m, { n: 1 }, "es"), "1 plant");
      assert.equal(formatMessage(m, { n: 0 }, "es"), "0 plants");
      assert.equal(formatMessage(m, { n: 1 }, "it"), "1 plant");
      assert.equal(formatMessage(m, { n: 11 }, "it"), "11 plants");
    });
  });

  it("es and it use 'many' for round millions, and fall back to other", () => {
    withoutPluralRules(() => {
      const m = "{n, plural, one {a} many {m} other {o}}";
      assert.equal(formatMessage(m, { n: 1000000 }, "es"), "m");
      assert.equal(formatMessage(m, { n: 1000000 }, "it"), "m");
      assert.equal(formatMessage(m, { n: 5 }, "es"), "o");
      const noMany = "{n, plural, one {a} other {o}}";
      assert.equal(formatMessage(noMany, { n: 1000000 }, "es"), "o");
    });
  });

  it("matches Intl.PluralRules where it exists", () => {
    const m = "{n, plural, one {one} many {many} other {other}}";
    for (const locale of ["en-GB", "es", "it"]) {
      for (const n of [0, 1, 2, 5, 11, 21, 100, 1.5, 1000000, 2000000]) {
        const expected = new Intl.PluralRules(locale).select(n);
        const want = ["one", "many"].includes(expected) ? expected : "other";
        let got = "";
        withoutPluralRules(() => {
          got = formatMessage(m, { n }, locale);
        });
        assert.equal(got, want, `${locale} ${String(n)}`);
      }
    }
  });
});
