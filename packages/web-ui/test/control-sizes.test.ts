// SPDX-License-Identifier: AGPL-3.0-only
// Controls sized to the text at desktop width. The computed-style check at 1440x900 and
// 390x844 is `node scripts/control-sizes.mjs` (headless Chrome, red before the fix); these are the
// static guards for the tokens it relies on.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("control sizes", () => {
  it("controls use the body text size at desktop width", () => {
    assert.match(html, /--ctl-font:\s*1rem/);
    assert.doesNotMatch(html, /--ctl-font:\s*0\.9rem/);
  });
  it("no control rule sets its own smaller font size", () => {
    const rules = [
      ...html.matchAll(/(article button|dl\.known select|\.rain button|\.bang)[^{]*\{[^}]*\}/g),
    ];
    assert.ok(rules.length >= 3);
    for (const r of rules) assert.doesNotMatch(r[0], /font-size:\s*0\.\d+(rem|em)/, r[0]);
  });
  it("desktop form padding is tight and buttons share the control height token", () => {
    assert.match(html, /--pico-form-element-spacing-vertical:\s*0\.25rem/);
    assert.match(html, /select,\s*button\s*\{\s*min-height:\s*var\(--ctl-h\)/);
    assert.match(html, /\.modal-foot button\s*\{\s*min-height:\s*var\(--ctl-h\)/);
  });
});
