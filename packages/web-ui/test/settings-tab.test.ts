// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { t } from "@green-garden/i18n";

const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
const view = readFileSync(`${import.meta.dirname}/../src/settings-view.ts`, "utf8");

/** Source text of `text` between `from` and the next `to` (the DOM layer is not importable under node). */
function between(from: string, to: string, text = src): string {
  const i = text.indexOf(from);
  assert.ok(i >= 0, `${from} is in the source`);
  return text.slice(i, text.indexOf(to, i + from.length));
}

describe("Measure the water lives in Settings, not in Planning", () => {
  it("there is a Settings tab", () => {
    assert.match(
      between("function panel(", "/** The UI language"),
      /case "settings":\s+return settingsHtml\(data, homeDraft\)/,
    );
    assert.equal(t("tab.settings"), "Settings");
  });

  it("the Planning tab does not carry the measuring section", () => {
    assert.doesNotMatch(
      between("export function planningHtml(", "export function savePlanning(", view),
      /calibrationHtml/,
    );
  });

  it("Settings offers it behind one button, quietly: a disclosure, no pop-up, no badge", () => {
    const section = between("export function settingsHtml(", "export function saveSettings(", view);
    assert.match(section, /calibrationHtml\(data\)/);
    assert.match(section, /<details/);
    assert.match(section, /settings\.measureWater/);
    assert.doesNotMatch(section, /confirm|alert|badge/i);
  });

  it("the invitation on a plant card now points to Settings", () => {
    assert.match(between("function plantCard(", "const logs ="), /href="#settings"/);
    assert.doesNotMatch(src, /href="#holidays"/);
  });

  it("the card shows the 'a bit more water each time' line when there is one", () => {
    assert.match(between("function plantCard(", "const logs ="), /lines\.adjustNote/);
  });
});
