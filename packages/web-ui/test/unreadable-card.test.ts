// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { importData, invalidPlants, type Plant } from "@green-garden/storage";
import {
  HELP_ISSUE_URL,
  MAX_ISSUE_URL,
  helpBody,
  helpUrl,
  unreadableCardHtml,
} from "../src/unreadable-view.ts";

afterEach(() => {
  setLocale("en-GB");
});

const kept = (extra: Record<string, unknown> = {}): Plant => {
  const text = JSON.stringify({
    format: "green-garden-export",
    version: 11,
    plants: [{ id: "m", name: "Misty", style: "mist", intervalDays: 3, logs: [], ...extra }],
    rooms: [],
  });
  const p = invalidPlants(importData(text, { keepInvalid: true }).data)[0];
  assert.ok(p);
  return p;
};

describe("the card of an unreadable plant", () => {
  it("says why in plain words and offers three ways out, with no raw keys or NaN", () => {
    const html = unreadableCardHtml(kept(), undefined);
    assert.match(html, /This plant could not be read/);
    assert.match(html, /care style &#34;mist&#34; is not one this version knows/);
    for (const label of ["See its data", "Ask for help", "Delete"]) assert.ok(html.includes(label));
    assert.doesNotMatch(html, /NaN|card\.|amount\.|Care style\.|About /);
    assert.doesNotMatch(html, /<details/);
  });

  it("is worded in Spanish and Italian", () => {
    setLocale("es");
    assert.match(unreadableCardHtml(kept(), undefined), /Ver sus datos/);
    setLocale("it");
    assert.match(unreadableCardHtml(kept(), undefined), /Vedi i suoi dati/);
  });

  it("shows the plant's JSON in a box to edit, and the reason a check failed", () => {
    const p = kept();
    const html = unreadableCardHtml(p, {
      id: "m",
      mode: "data",
      text: '{ "id": "m" }',
      problem: { kind: "badValue", field: "style", value: "spray" },
    });
    assert.match(html, /<textarea/);
    assert.match(html, /Check and save/);
    assert.match(html, /Not saved\. Its care style &#34;spray&#34;/);
  });
});

describe("Ask for help posts nothing by itself", () => {
  it("shows what would be posted, with the versions, the reason and the plant's JSON", () => {
    const body = helpBody(kept());
    assert.match(body, /data format version 11/);
    assert.match(body, /style has the value "mist"/);
    assert.match(body, /"name": "Misty"/);
    const html = unreadableCardHtml(kept(), { id: "m", mode: "help", text: body });
    assert.match(html, /GitHub issues are public/);
    assert.match(html, /Open GitHub/);
    assert.match(html, /Misty/);
  });

  it("opens the public core issue form, prefilled", () => {
    const url = helpUrl(helpBody(kept()));
    assert.ok(url.startsWith(`${HELP_ISSUE_URL}?title=`));
    assert.match(HELP_ISSUE_URL, /Koalk\/green-garden-core\/issues\/new$/);
    assert.match(decodeURIComponent(url), /body=Green Garden web UI/);
  });

  it("keeps a huge plant under the address limit and says the data was cut", () => {
    const logs = Array.from({ length: 2000 }, (_, i) => ({
      date: "2026-10-01",
      outcome: "done",
      i,
    }));
    const body = helpBody(kept({ logs }));
    const url = helpUrl(body);
    assert.ok(url.length <= MAX_ISSUE_URL, String(url.length));
    assert.match(decodeURIComponent(url), /cut short/);
    const html = unreadableCardHtml(kept({ logs }), { id: "m", mode: "help", text: body });
    assert.match(html, /cut short/);
  });
});
