// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData, type AppData } from "@green-garden/storage";
import { addPlant } from "../src/actions.ts";
import {
  aroundPlants,
  cardWords,
  dayEntries,
  makePlan,
  plantRows,
  todayLine,
  windowsFor,
} from "../src/view.ts";

const TODAY = "2026-11-02";
const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");

afterEach(() => {
  setLocale("en-GB");
});

/** Two plants due today: p1 with the user's own values, p2 with two assumed fields (assumed margin). */
function garden(): AppData {
  let d = addPlant(emptyData(), {
    name: "Mine",
    style: "let_top_dry",
    intervalDays: 7,
    lastWatered: "2026-10-26",
  });
  d = addPlant(d, {
    name: "Guessed",
    style: "let_top_dry",
    intervalDays: 7,
    lastWatered: "2026-10-26",
    fieldSources: { drainage: "default", potMaterial: "default" },
  });
  return d;
}

function rows(d: AppData = garden()) {
  const windows = windowsFor(d, TODAY);
  const all = plantRows(makePlan(d, TODAY), windows, d);
  const row = (id: string) => {
    const r = all.find((x) => x.plant.id === id);
    assert.ok(r, id);
    return r;
  };
  return { windows, mine: row("p1"), guessed: row("p2") };
}

describe("the engine's wording reaches the screens", () => {
  it("windows come from the plan input, so the assumed fields count", () => {
    const { windows } = rows();
    assert.equal(windows.find((w) => w.plantId === "p1")?.wording, "exact");
    assert.equal(windows.find((w) => w.plantId === "p2")?.wording, "around");
    assert.deepEqual([...aroundPlants(windows)], ["p2"]);
  });

  it("plant rows say which wording to use", () => {
    const { mine, guessed } = rows();
    assert.equal(mine.around, false);
    assert.equal(guessed.around, true);
  });
});

describe("plant detail: soft wording for assumed values, exact for the user's own", () => {
  it("care line says 'around every N days' only for the assumed plant", () => {
    const { mine, guessed } = rows();
    assert.match(cardWords(guessed).care, /around every 7 days/);
    assert.match(cardWords(mine).care, /, every 7 days/);
    assert.doesNotMatch(cardWords(mine).care, /around/);
  });

  it("next watering and window say 'about' only for the assumed plant", () => {
    const { mine, guessed } = rows();
    assert.match(cardWords(guessed).next, /^Next: about \d{4}-\d{2}-\d{2}$/);
    assert.match(cardWords(mine).next, /^Next: \d{4}-\d{2}-\d{2}$/);
    assert.match(cardWords(guessed).window, /^about \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    assert.match(cardWords(mine).window, /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  });

  it("no window and no next watering still read as before", () => {
    const { guessed } = rows();
    const bare = { ...guessed, nextWatering: undefined, window: undefined };
    assert.equal(cardWords(bare).next, "Next: none planned");
    assert.equal(cardWords(bare).window, "none");
  });
});

describe("Today card: soft wording for assumed values", () => {
  it("the assumed plant's line says 'about'; the user's own keeps its exact reason", () => {
    const d = garden();
    const plan = makePlan(d, TODAY);
    const entries = dayEntries(plan, d, TODAY, aroundPlants(windowsFor(d, TODAY)));
    const line = (id: string): string => {
      const e = entries.find((x) => x.plantId === id);
      assert.ok(e, id);
      return todayLine(e);
    };
    assert.match(line("p2"), /About due/);
    assert.doesNotMatch(line("p1"), /about/i);
    assert.equal(line("p1"), entries.find((x) => x.plantId === "p1")?.why);
  });

  it("dayEntries without the set marks nothing as around (older callers)", () => {
    const d = garden();
    for (const e of dayEntries(makePlan(d, TODAY), d, TODAY)) assert.equal(e.around, false);
  });
});

describe("the keys in es and it (machine drafts)", () => {
  it("Spanish", () => {
    setLocale("es");
    const { mine, guessed } = rows();
    assert.match(cardWords(guessed).care, /aproximadamente cada 7 días/);
    assert.doesNotMatch(cardWords(mine).care, /aproximadamente/);
    assert.match(cardWords(guessed).next, /^Siguiente: hacia el /);
  });

  it("Italian", () => {
    setLocale("it");
    const { mine, guessed } = rows();
    assert.match(cardWords(guessed).care, /circa ogni 7 giorni/);
    assert.doesNotMatch(cardWords(mine).care, /circa/);
    assert.match(cardWords(guessed).next, /^Prossima: verso il /);
  });
});

describe("app.ts uses them", () => {
  it("the Plants tab and Today read the plan input's windows and the soft wording", () => {
    assert.match(src, /windowsFor\(data, today\)/);
    assert.match(src, /cardWords\(r\)/);
    assert.match(src, /todayLine\(e\)/);
    assert.doesNotMatch(src, /computeWindows\(\{/, "no windows from the raw plants");
  });
});
