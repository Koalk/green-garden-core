// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { answerFollowUp, draftFromSettings, pickClimate, pickRegion } from "@green-garden/bulk";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import { homeDialogHtml, homeFormHtml } from "../src/home-view.ts";
import { settingsHtml } from "../src/settings-view.ts";

afterEach(() => {
  setLocale("en-GB");
});

const empty = draftFromSettings({});

describe("Q-K0 form", () => {
  it("starts with a region list grouped by country and no follow-ups", () => {
    const html = homeFormHtml(empty);
    assert.match(html, /data-form="home"/);
    assert.match(html, /<optgroup label="United Kingdom">/);
    assert.match(html, /<optgroup label="Spain">/);
    assert.match(html, /name="homeRegion"/);
    assert.match(html, /Scotland: west, north, Highlands and Islands/);
    assert.doesNotMatch(html, /data-home="follow"/);
  });

  it("a region with a follow-up shows it, and the suggestion appears once it is answered", () => {
    const d0 = pickRegion(empty, "gb-scotland-west");
    const asked = homeFormHtml(d0);
    assert.match(asked, /Is the garden above about 300 m\?/);
    assert.match(asked, /data-home="follow"/);
    const d1 = answerFollowUp(d0, 0, "high");
    const html = homeFormHtml(d1);
    assert.match(html, /We suggest Mountain or highland, with winters down to about −15 °C/);
    assert.match(html, /Scotland: west, north, Highlands and Islands, Yes|Yes/);
  });

  it("a required follow-up unanswered says so instead of suggesting", () => {
    const html = homeFormHtml(pickRegion(empty, "es-canary-high-islands"));
    assert.match(html, /Answer the questions above/);
    assert.doesNotMatch(html, /We suggest/);
  });

  it("the suggestion fills both selects, and both can be changed", () => {
    const d = pickRegion(empty, "gb-england-east");
    const html = homeFormHtml(d);
    assert.match(html, /<option value="oceanic_dry" selected>/);
    assert.match(html, /<option value="H4" selected>/);
    const changed = homeFormHtml(pickClimate(d, "med_mild"));
    assert.match(changed, /<option value="med_mild" selected>/);
  });

  it("with no suggestion yet, both selects wait on a 'Choose' option", () => {
    const html = homeFormHtml(empty);
    assert.match(html, /name="homeClimate"[^>]*>\s*<option value="" selected>/);
  });

  it("the gate dialog explains why it asks and has 'Not now'", () => {
    const html = homeDialogHtml(empty);
    assert.match(html, /<dialog id="home-modal"/);
    assert.match(html, /we ask once before saving the first one/);
    assert.match(html, /data-action="home-cancel"[^>]*>Not now</);
    assert.match(html, /data-form="home"/);
  });

  it("is also in Settings, as its own form after the preferences", () => {
    const data = emptyData();
    const html = settingsHtml(data);
    assert.match(html, /data-form="settings"/);
    assert.match(html, /data-form="home"/);
    assert.ok(html.indexOf('data-form="home"') > html.indexOf('data-form="settings"'));
    assert.doesNotMatch(html, /data-action="home-cancel"/);
  });

  it("Settings starts from the climate already saved", () => {
    const data = emptyData();
    const withHome = {
      ...data,
      settings: { ...data.settings, climate: "arid", winterMin: "H2" },
    } as const;
    const html = settingsHtml(withHome);
    assert.match(html, /<option value="arid" selected>/);
    assert.match(html, /<option value="H2" selected>/);
  });

  it("speaks Spanish with the region names in Spanish", () => {
    setLocale("es");
    const html = homeFormHtml(pickRegion(empty, "gb-england-east"));
    assert.match(html, /¿Dónde está tu jardín\?/);
    assert.match(html, /Reino Unido/);
  });
});
