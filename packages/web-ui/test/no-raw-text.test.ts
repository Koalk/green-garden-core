// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * user-visible text goes through t(). This is a cheap lint: it flags HTML text nodes and
 * accessible-name attributes that contain a literal word, in the files that build the UI. Words that
 * are not language ("OpenPlantbook", "JSON") are listed in ALLOWED.
 */
const dir = new URL("../src/", import.meta.url);
const SKIP = new Set(["pilot-data.ts", "names.ts", "text.ts", "fixture.ts"]);
const ALLOWED = new Set(["OpenPlantbook", "JSON", "&times;"]);

const TEXT_NODE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>([^<>{}$`]*[A-Za-z]{3,}[^<>{}$`]*)</gi;
const ATTR = /(?:aria-label|title|placeholder|alt|label)="([^"$]*[A-Za-z]{3,}[^"$]*)"/g;

function offences(src: string): string[] {
  const out: string[] = [];
  for (const re of [TEXT_NODE, ATTR]) {
    for (const m of src.matchAll(re)) {
      const text = (m[1] ?? "").trim();
      if (text !== "" && !ALLOWED.has(text)) out.push(text);
    }
  }
  return out;
}

describe("no raw English in the UI source", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !SKIP.has(x))) {
    it(`${f} has no literal words in element text`, () => {
      assert.deepEqual(offences(readFileSync(new URL(f, dir), "utf8")), []);
    });
  }

  it("the check itself catches a literal and lets t() calls through", () => {
    assert.deepEqual(offences("`<button>Save</button>`"), ["Save"]);
    assert.deepEqual(offences('`<button aria-label="Close">x</button>`'), ["Close"]);
    assert.deepEqual(offences("`<button>${t('common.save')}</button>`"), []);
    assert.deepEqual(offences("`<p>${t('a')} <small>${esc(x)}</small></p>`"), []);
  });
});
