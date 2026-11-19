// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { setLocale, t } from "@green-garden/i18n";
import { emptyData, type AppData } from "@green-garden/storage";
import { setDisplay, setHome, setLanguage, setPrefs, setSettings } from "../src/actions.ts";
import { planningHtml, savePlanning, saveSettings, settingsHtml } from "../src/settings-view.ts";
import { TABS, legacyHash, tabFromHash } from "../src/tabs.ts";

const TODAY = "2026-11-02";
const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");

afterEach(() => {
  setLocale("en-GB");
});

/** A `name=` attribute of a form control, so a label that merely mentions the word does not count. */
const control = (name: string): RegExp => new RegExp(`name="${name}"`);

const PLANNING_CONTROLS = [
  "from",
  "to",
  "unavailableWeekdays",
  "preferredWeekdays",
  "preLeaveWatering",
  "horizonDays",
];
const SETTINGS_CONTROLS = [
  "measure",
  "amountMode",
  "wording",
  "pets",
  "children",
  "locale",
  "weekStart",
  "hemisphere",
  "country",
];

/** Everything set away from the defaults, so a save that resets a field shows. */
function busy(): AppData {
  return setLanguage(
    setDisplay(
      setHome(
        setSettings(
          setPrefs(emptyData(), {
            unavailableWeekdays: [2],
            preferredWeekdays: [6],
            preLeaveWatering: false,
          }),
          { hemisphere: "south", horizonDays: 42 },
        ),
        "ES",
      ),
      { measure: "glass", amountMode: "precise", wording: "us", pets: ["cat"], children: true },
    ),
    { locale: "it", weekStart: 0 },
  );
}

describe("tabs: Holidays is now Planning", () => {
  it("the tab list has Planning where Holidays was", () => {
    assert.deepEqual(TABS, ["today", "plants", "planning", "settings", "data"]);
  });

  it("the old #holidays anchor opens Planning and is rewritten to #planning", () => {
    assert.equal(tabFromHash("#holidays"), "planning");
    assert.equal(legacyHash("#holidays"), "#planning");
    assert.equal(legacyHash("#planning"), undefined);
    assert.equal(legacyHash("#settings"), undefined);
  });

  it("the other anchors keep working", () => {
    assert.equal(tabFromHash("#planning"), "planning");
    assert.equal(tabFromHash("#settings"), "settings");
    assert.equal(tabFromHash("#improve"), "plants");
    assert.equal(tabFromHash("#data"), "data");
    assert.equal(tabFromHash(""), "today");
    assert.equal(tabFromHash("#nonsense"), "today");
  });

  it("the app rewrites the old anchor without a history entry", () => {
    assert.match(src, /legacyHash\(window\.location\.hash\)/);
    assert.match(src, /history\.replaceState/);
  });

  it("the name in all three languages", () => {
    assert.equal(t("tab.planning"), "Planning");
    setLocale("es");
    assert.equal(t("tab.planning"), "Planificación");
    setLocale("it");
    assert.equal(t("tab.planning"), "Pianificazione");
  });
});

describe("each control is on its new tab", () => {
  it("Planning keeps away days, the days you cannot or prefer to water, pre-leave and plan length", () => {
    const h = planningHtml(busy(), TODAY);
    for (const c of PLANNING_CONTROLS) assert.match(h, control(c), c);
    for (const c of SETTINGS_CONTROLS) assert.doesNotMatch(h, control(c), c);
    assert.match(h, /data-form="planning"/);
    assert.match(h, /data-form="away"/);
    assert.match(h, new RegExp(t("planning.heading")));
  });

  it("Settings has the preferences and still the Measure the water disclosure", () => {
    const h = settingsHtml(busy());
    for (const c of SETTINGS_CONTROLS) assert.match(h, control(c), c);
    for (const c of PLANNING_CONTROLS) assert.doesNotMatch(h, control(c), c);
    assert.match(h, /data-form="settings"/);
    assert.match(h, /<details><summary>Measure the water \(optional\)<\/summary>/);
    assert.match(h, /data-form="calibration"/);
  });

  it("each form shows the stored values", () => {
    const s = settingsHtml(busy());
    assert.match(s, /value="south" selected/);
    assert.match(s, /value="ES" selected/);
    assert.match(s, /value="glass" selected/);
    assert.match(s, /value="precise" selected/);
    assert.match(s, /value="us" selected/);
    assert.match(s, /name="pets" value="cat" checked/);
    assert.match(s, /name="children" value="1" checked/);
    assert.match(s, /value="it" selected/);
    assert.match(s, /value="0" selected/);
    const p = planningHtml(busy(), TODAY);
    assert.match(p, /name="horizonDays"[^>]*value="42"/);
    assert.match(p, /name="unavailableWeekdays" value="2" checked/);
    assert.match(p, /name="preferredWeekdays" value="6" checked/);
    assert.doesNotMatch(p, /name="preLeaveWatering" checked/);
  });
});

describe("each form still saves, and only its own fields", () => {
  it("Planning saves the scheduling fields and leaves the preferences alone", () => {
    const before = busy();
    const f = new URLSearchParams([
      ["unavailableWeekdays", "1"],
      ["unavailableWeekdays", "3"],
      ["preferredWeekdays", "0"],
      ["preLeaveWatering", "on"],
      ["horizonDays", "60"],
    ]);
    const after = savePlanning(before, f);
    assert.deepEqual(after.settings.prefs.unavailableWeekdays, [1, 3]);
    assert.deepEqual(after.settings.prefs.preferredWeekdays, [0]);
    assert.equal(after.settings.prefs.preLeaveWatering, true);
    assert.equal(after.settings.horizonDays, 60);
    for (const k of [
      "hemisphere",
      "country",
      "measure",
      "amountMode",
      "wording",
      "household",
      "locale",
      "weekStart",
    ] as const) {
      assert.deepEqual(after.settings[k], before.settings[k], k);
    }
  });

  it("Planning clamps the plan length as before", () => {
    const f = (v: string): URLSearchParams => new URLSearchParams([["horizonDays", v]]);
    assert.equal(savePlanning(emptyData(), f("3")).settings.horizonDays, 7);
    assert.equal(savePlanning(emptyData(), f("500")).settings.horizonDays, 120);
    assert.equal(savePlanning(emptyData(), f("")).settings.horizonDays, 28);
  });

  it("Settings saves the preferences and leaves the planning fields alone", () => {
    const before = busy();
    const f = new URLSearchParams([
      ["measure", "mug"],
      ["amountMode", "qualitative"],
      ["wording", "uk"],
      ["pets", "dog"],
      ["locale", "es"],
      ["weekStart", "1"],
      ["hemisphere", "north"],
      ["country", "GB"],
    ]);
    const after = saveSettings(before, f);
    assert.equal(after.settings.hemisphere, "north");
    assert.equal(after.settings.country, "GB");
    assert.equal(after.settings.locale, "es");
    assert.equal(after.settings.weekStart, 1);
    assert.deepEqual(after.settings.household, { pets: ["dog"] });
    assert.equal(after.settings.amountMode ?? "qualitative", "qualitative");
    assert.deepEqual(after.settings.prefs, before.settings.prefs);
    assert.equal(after.settings.horizonDays, before.settings.horizonDays);
  });

  it("Settings: automatic language, week start and home clear the stored value", () => {
    const after = saveSettings(
      busy(),
      new URLSearchParams([
        ["locale", "auto"],
        ["weekStart", "auto"],
        ["country", "auto"],
        ["hemisphere", "south"],
      ]),
    );
    assert.equal("locale" in after.settings, false);
    assert.equal("weekStart" in after.settings, false);
    assert.equal("country" in after.settings, false);
  });

  it("the app wires both forms and their own save buttons", () => {
    assert.match(src, /case "planning":[\s\S]{0,80}savePlanning\(data, f\)/);
    assert.match(src, /case "settings":[\s\S]{0,200}saveSettings\(data, f\)/);
    assert.equal(t("planning.save"), "Save planning");
    assert.equal(t("settings.save"), "Save settings");
  });
});
