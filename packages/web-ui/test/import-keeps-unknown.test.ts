// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addPlant, readImportFile } from "../src/index.ts";
import { emptyData, exportData, invalidPlants } from "@green-garden/storage";

/** An export with one good plant and one whose style this build does not know. */
function fileWithMist(): string {
  const base = addPlant(emptyData(), { name: "Fern", style: "keep_moist", intervalDays: 7 });
  const raw = JSON.parse(exportData(base)) as { plants: Record<string, unknown>[] };
  raw.plants.push({ id: "mist-1", name: "Misty", style: "mist", intervalDays: 3 });
  return JSON.stringify(raw);
}

describe("import keeps a plant with an unknown style", () => {
  it("counts it and marks it as unreadable", () => {
    const res = readImportFile(fileWithMist());
    assert.equal(res.data.plants.length, 2);
    assert.equal(invalidPlants(res.data).length, 1);
  });

  it("survives import then export", () => {
    const res = readImportFile(fileWithMist());
    const back = JSON.parse(exportData(res.data)) as { plants: { id: string; style: string }[] };
    const mist = back.plants.find((p) => p.id === "mist-1");
    assert.equal(mist?.style, "mist");
  });
});

import { setLocale } from "@green-garden/i18n";
import { fixtureData } from "../src/fixture.ts";
import { addAwayRange, makePlan, warnings } from "../src/index.ts";

describe("a plant watered today gets no 'since' warning", () => {
  it("an away stretch ahead names the stretch, never '0 days ago'", () => {
    setLocale("en-GB");
    const today = "2026-11-10";
    const d0 = fixtureData(today);
    const watered = { ...d0, plants: d0.plants.map((p) => ({ ...p, lastWatered: today })) };
    const d = addAwayRange(watered, "2026-11-12", "2026-12-06");
    assert.ok(d);
    const w = warnings(makePlan(d, today, undefined, []), d, today);
    assert.ok(w.length > 0, "the stretch still warns about the future");
    for (const x of w) {
      assert.doesNotMatch(x.text, /0 days ago/);
      assert.doesNotMatch(x.text, /last watered on/);
    }
  });
});

import { t } from "@green-garden/i18n";
import { wateredTodayCount, waterAll } from "../src/index.ts";

describe("Today says how many plants were watered", () => {
  it("counts the plants with a done log today, and words it with plurals", () => {
    setLocale("en-GB");
    const today = "2026-11-10";
    const d0 = fixtureData(today);
    assert.equal(wateredTodayCount(d0, today), 0);
    const ids = d0.plants.slice(0, 3).map((p) => p.id);
    const d = waterAll(d0, ids, today);
    assert.equal(wateredTodayCount(d, today), 3);
    assert.equal(t("today.wateredCount", { n: 3 }), "3 plants watered today.");
    assert.equal(t("today.wateredCount", { n: 1 }), "1 plant watered today.");
  });
});

import { readFileSync } from "node:fs";

describe("phone calendar lists names under the day", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const phone = html.slice(html.indexOf("@media (max-width: 599px)"));
  it("below the phone breakpoint the day cells stack and names never break mid-word", () => {
    assert.match(phone, /#calendar td\s*\{[^}]*display:\s*block/);
    assert.match(phone, /#calendar thead,[^{]*\{[^}]*display:\s*none/);
    assert.match(phone, /#calendar td\.empty[^{]*\{[^}]*display:\s*none/);
    assert.match(phone, /#calendar td div\s*\{[^}]*overflow-wrap:\s*normal/);
  });
  it("cells with nothing in them carry the empty class", () => {
    assert.match(app, /"empty"/);
  });
});

import { notMovedText } from "../src/moves.ts";

describe("cancelling an edit's move sheet says so", () => {
  it("names where the plant still is", () => {
    setLocale("en-GB");
    const d = fixtureData("2026-11-10");
    const indoor = d.plants.find((p) => p.placement !== "ground" && p.placement !== "outdoor_pot");
    assert.ok(indoor);
    assert.equal(notMovedText(indoor), "Not moved: still indoors.");
    assert.equal(
      notMovedText({ ...indoor, placement: "outdoor_pot" }),
      "Not moved: still outside.",
    );
  });
  it("app wires move-cancel to it", () => {
    assert.match(readFileSync(new URL("../src/app.ts", import.meta.url), "utf8"), /notMovedText/);
  });
});

import { readdirSync } from "node:fs";

describe("no string still says Holidays or Vacaciones/Vacanze", () => {
  const dir = new URL("../../i18n/src/locales/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    it(f, () => {
      const text = readFileSync(new URL(f, dir), "utf8");
      const values = Object.values(JSON.parse(text) as Record<string, string>).join("\n");
      assert.doesNotMatch(values, /\bHolidays\b|\bVacaciones\b|\bVacanze\b/);
    });
  }
});

describe("a modal keeps the scrollbar", () => {
  it("html keeps its vertical scrollbar while a dialog is open", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /html:has\(dialog\[open\]\)\s*\{[^}]*overflow-y:\s*scroll/);
  });
});
