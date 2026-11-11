// SPDX-License-Identifier: AGPL-3.0-only
// fixes from the first click-through. Each block was red before its fix.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { setLocale, t } from "@green-garden/i18n";
import { fixtureData } from "../src/fixture.ts";
import { addAwayRange } from "../src/actions.ts";
import { makePlan, modalHtml, speciesPanelHtml, warnings } from "../src/index.ts";
import { nextActive, SearchSession } from "../src/search-nav.ts";
import { SPECIES } from "../src/pilot-data.ts";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const pm = readFileSync(new URL("../src/plant-modal.ts", import.meta.url), "utf8");
const TODAY = "2026-11-10";

describe("desktop sizing", () => {
  it("sets the base font and control heights from CSS tokens, scaled at a desktop breakpoint", () => {
    assert.match(html, /--ctl-h:/);
    assert.match(html, /@media \(min-width: 900px\)/);
    assert.match(html, /--pico-font-size:/);
    assert.match(html, /max-width:\s*\d+(rem|px)/);
  });
});

describe("no layout shift on Plants", () => {
  it("reserves the scrollbar and fixes thumbnail boxes", () => {
    assert.match(html, /scrollbar-gutter:\s*stable/);
    assert.match(html, /\.photo img[^}]*height:\s*72px/s);
    assert.match(html, /aspect-ratio|\.card-photo|min-height/);
  });
  it("every photo image carries width and height attributes", () => {
    const src = readFileSync(new URL("../src/modal.ts", import.meta.url), "utf8");
    const imgs = [...src.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    assert.ok(imgs.length > 0);
    for (const i of imgs)
      assert.match(i, /width="\d+"[^>]*height="\d+"|height="\d+"[^>]*width="\d+"/, i);
  });
});

describe("search keyboard", () => {
  it("arrow keys move a highlight inside the list and back to the box", () => {
    assert.equal(nextActive(-1, 1, 3), 0);
    assert.equal(nextActive(0, 1, 3), 1);
    assert.equal(nextActive(2, 1, 3), 2);
    assert.equal(nextActive(1, -1, 3), 0);
    assert.equal(nextActive(0, -1, 3), -1);
    assert.equal(nextActive(-1, -1, 3), 2);
    assert.equal(nextActive(-1, 1, 0), -1);
  });
  it("a late answer to an earlier keystroke is stale after a pick closes the list", () => {
    const s = new SearchSession();
    const a = s.begin();
    assert.equal(s.isCurrent(a), true);
    s.close();
    assert.equal(s.isCurrent(a), false);
    const b = s.begin();
    assert.equal(s.isCurrent(b), true);
    assert.equal(s.isCurrent(a), false);
  });
  it("the modal uses aria-activedescendant, Enter takes the highlighted option, and a pick closes the session", () => {
    assert.match(pm, /aria-activedescendant/);
    const enter = pm.slice(pm.indexOf('ev.key === "Enter"'));
    assert.match(enter.slice(0, 600), /active/);
    const clear = pm.slice(pm.indexOf("function clearSearch"), pm.indexOf("function search("));
    assert.match(clear, /session\.close\(\)/);
  });
});

describe("already watered wording", () => {
  it("en-GB, es and it", () => {
    setLocale("en-GB");
    assert.equal(t("earlier.button"), "Already watered? Pick the day");
    assert.match(t("earlier.aria", { name: "Fern" }), /^Already watered\? Pick the day.*Fern/);
    setLocale("es");
    assert.doesNotMatch(t("earlier.button"), /antes/);
    setLocale("it");
    assert.doesNotMatch(t("earlier.button"), /prima/);
    setLocale("en-GB");
  });
});

describe("one scroll area in a modal", () => {
  it("locks the page scroll while a modal is open and gives the dialog one scroller", () => {
    assert.match(html, /:has\(dialog\[open\]\)[^{]*\{[^}]*overflow:\s*hidden/s);
    assert.match(html, /overscroll-behavior:\s*contain/);
  });
});

describe("alternatives behind a Not sure control", () => {
  const row = SPECIES.find((s) => s.lookAlikes !== undefined && s.lookAlikes.length > 0);
  it("is a closed collapsible with a ? tooltip, not an open list", () => {
    assert.ok(row);
    setLocale("en-GB");
    const h = speciesPanelHtml({ kind: "catalogue", row }, SPECIES, new Map());
    assert.match(h, /<details class="alts">/);
    assert.doesNotMatch(h, /<details[^>]*\sopen/);
    assert.match(h, /Not sure\? Plants with similar names or looks/);
    assert.match(h, /class="help"[^>]*title="[^"]+"/);
  });
  it("bulk add uses the same words", () => {
    setLocale("en-GB");
    assert.equal(t("bulk.match.change"), "Not sure? Plants with similar names or looks");
  });
  it("modalHtml still renders", () => {
    assert.match(modalHtml({ fields: {}, rooms: [], title: "x" }), /species-results/);
  });
});

describe("Away in the calendar", () => {
  it("is capitalised, with an icon and an accessible name", () => {
    setLocale("en-GB");
    assert.equal(t("calendar.away"), "Away");
    assert.match(
      app,
      /class="away-mark" role="img" aria-label="\$\{esc\(t\("calendar.away"\)\)\}"/,
    );
  });
});

describe("warnings name their cause", () => {
  it("an overdue plant says when it was last watered, with a link to the plant", () => {
    setLocale("en-GB");
    const d0 = fixtureData(TODAY);
    const d = { ...d0, plants: d0.plants.map((p) => ({ ...p, lastWatered: "2026-09-01" })) };
    const w = warnings(makePlan(d, TODAY, undefined, []), d, TODAY);
    assert.ok(w.length > 0);
    for (const x of w) {
      assert.doesNotMatch(x.text, /the gap between waterings/);
      assert.match(x.text, /2026-09-01/);
      assert.ok(x.links.some((l) => l.href === "#plants"));
    }
  });
  it("no warning when nothing is wrong", () => {
    const d = fixtureData(TODAY);
    assert.deepEqual(warnings(makePlan(d, TODAY, undefined, []), d, TODAY), []);
  });
  it("away-day warnings name the stretch and link to Planning", () => {
    setLocale("en-GB");
    const d0 = fixtureData(TODAY);
    const d = addAwayRange(d0, "2026-11-10", "2026-12-06");
    assert.ok(d);
    const w = warnings(makePlan(d, TODAY, undefined, []), d, TODAY);
    const away = w.filter((x) => x.links.some((l) => l.href === "#planning"));
    for (const x of away) assert.match(x.text, /2026-11-\d\d to 2026-12-\d\d/);
  });
  it("Today renders the links", () => {
    assert.match(app, /w\.links/);
  });
});
