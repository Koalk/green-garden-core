// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { DEFAULT_SPACE_ID, type AppData, type Plant } from "@green-garden/storage";
import { answerQuestion, theyDiffer } from "../src/improve.ts";
import { detailHtml, improveHtml } from "../src/improve-view.ts";

const TODAY = "2026-11-03";

const aloe = (id: string, n: number): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: n === 1 ? "Aloe vera" : `Aloe vera ${String(n)}`,
  style: "let_top_dry",
  intervalDays: 14,
  logs: [{ date: "2026-11-01", outcome: "done" }],
  potDiameterCm: 15,
  fieldSources: { drainage: "default", light: "default", potDiameterCm: "default" },
  batch: { id: "b1" },
});

const data: AppData = {
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
  plants: [aloe("a", 1), aloe("b", 2), aloe("c", 3)],
  rooms: [],
  settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
};

afterEach(() => {
  setLocale("en-GB");
});

describe("plants added together: improve list and detail", () => {
  it("lists the group once and says the answer also goes to the other two", () => {
    const html = improveHtml(data, TODAY, new Set());
    assert.equal((html.match(/<article class="card">/g) ?? []).length, 1);
    assert.match(html, /Also for the other 2 aloe vera/);
    assert.match(html, /1 plant,/);
  });

  it("shows the line and a 'They differ' button under the answer, then takes the fill back", () => {
    const answered = answerQuestion(data, "a", "Q-POT", "large", TODAY);
    const html = detailHtml(answered, "a");
    assert.match(html, /Also for the other 2 aloe vera/);
    assert.match(html, /data-action="they-differ" data-target="a" data-q="Q-POT"/);
    assert.match(html, /They differ/);
    // the others show no such line: the answer is not theirs to undo
    assert.doesNotMatch(detailHtml(answered, "b"), /They differ/);
    const split = theyDiffer(answered, "a", "Q-POT");
    assert.doesNotMatch(detailHtml(split, "a"), /They differ/);
    assert.equal(split.plants[1]?.potDiameterCm, 15);
  });

  it("is worded in Spanish and Italian", () => {
    const answered = answerQuestion(data, "a", "Q-POT", "large", TODAY);
    setLocale("es");
    assert.match(detailHtml(answered, "a"), /También para las otras 2 aloe vera/);
    assert.match(detailHtml(answered, "a"), /Son distintas/);
    setLocale("it");
    assert.match(detailHtml(answered, "a"), /Anche per le altre 2 aloe vera/);
    assert.match(detailHtml(answered, "a"), /Sono diverse/);
  });
});
