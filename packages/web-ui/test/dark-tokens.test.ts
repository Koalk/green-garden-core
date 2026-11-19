// SPDX-License-Identifier: AGPL-3.0-only
// Dark mode tokens. The contrast check over every screen is `node scripts/dark-check.mjs`
// (headless Chrome; 108 failures before the fix); these are the static guards for its tokens.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("dark mode tokens", () => {
  it("raises muted text, muted borders and form edges for both ways dark is switched on", () => {
    const system =
      /prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--pico-muted-color:[^}]*--pico-form-element-border-color:/;
    assert.match(html, system);
    assert.match(html, /:root\[data-theme="dark"\]\s*\{[^}]*--pico-muted-border-color:/);
  });
  it("the pressed chip text has its own token and the assumed chip is not faded", () => {
    assert.match(html, /color:\s*var\(--chip-on-fg,/);
    assert.doesNotMatch(html, /\.chip-assumed\s*\{[^}]*opacity/);
  });
});
