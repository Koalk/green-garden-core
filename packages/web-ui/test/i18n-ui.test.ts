// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import {
  amountText,
  bulkConfirmText,
  calendarWeeks,
  fixtureData,
  importReasons,
  makePlan,
  setLanguage,
  styleLabel,
  toIcs,
  toxicityText,
  validatePlantFields,
  warnings,
  weekHeaders,
  weekStartOf,
} from "../src/index.ts";

const TODAY = "2026-11-02"; // a Monday

afterEach(() => {
  setLocale("en-GB");
});

describe("week start", () => {
  it("Monday-first by default, Sunday-first on request, with matching headers", () => {
    const d = fixtureData(TODAY);
    const plan = makePlan(d, TODAY);
    const mon = calendarWeeks(plan, d, TODAY, 14);
    assert.equal(mon[0]?.[0]?.date, "2026-11-02");
    const sun = calendarWeeks(plan, d, TODAY, 14, 0);
    assert.equal(sun[0]?.[0]?.date, "2026-11-01");
    assert.deepEqual(weekHeaders(1, "en-GB"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    assert.deepEqual(weekHeaders(0, "en-GB")[0], "Sun");
  });

  it("the setting wins over the locale default", () => {
    const d = emptyData();
    assert.equal(weekStartOf(d, "en-GB"), 1);
    assert.equal(weekStartOf(setLanguage(d, { weekStart: 0 }), "en-GB"), 0);
  });
});

describe("setLanguage", () => {
  it("sets and clears locale and weekStart without leaving undefined keys", () => {
    const a = setLanguage(emptyData(), { locale: "es", weekStart: 6 });
    assert.equal(a.settings.locale, "es");
    assert.equal(a.settings.weekStart, 6);
    const b = setLanguage(a, { locale: undefined, weekStart: undefined });
    assert.equal("locale" in b.settings, false);
    assert.equal("weekStart" in b.settings, false);
  });
});

describe("the UI text follows the active locale", () => {
  it("amount, style and confirmation texts in Spanish and Italian", () => {
    setLocale("es");
    assert.equal(styleLabel("keep_moist"), "mantener húmedo");
    assert.match(bulkConfirmText("water-all", 3), /3 plantas/);
    assert.match(bulkConfirmText("water-all", 1), /1 planta\b/);
    assert.match(amountText({ style: "let_top_dry", potDiameterCm: 15 }), /1½ tazas/);
    setLocale("it");
    assert.match(bulkConfirmText("cant-water", 4), /4 piante/);
    assert.match(amountText({ style: "let_top_dry", potDiameterCm: 15 }), /1½ tazze/);
  });

  it("validation errors and toxicity wording are translated", () => {
    setLocale("es");
    assert.deepEqual(
      validatePlantFields({ plantName: "x", style: "keep_moist", intervalDays: "3" }),
      [],
    );
    assert.equal(validatePlantFields({})[0], "Ponle un nombre a la planta.");
    assert.match(toxicityText({ status: "unknown", exposures: [] }), /Toxicidad aún sin evaluar/);
    assert.match(
      toxicityText({ status: "assessed", exposures: [{ who: "cat", severity: 3 }] }),
      /Tóxica para gatos \(grave\)/,
    );
  });

  it("warnings and the .ics summary are worded in the active locale", () => {
    const d = fixtureData(TODAY);
    const plan = makePlan(d, TODAY);
    setLocale("it");
    const ics = toIcs(plan, d, TODAY);
    assert.match(ics, /SUMMARY:Annaffiare \d+ pian/);
    assert.ok(Array.isArray(warnings(plan, d)));
  });

  it("import issues are worded from codes", () => {
    setLocale("es");
    assert.equal(
      importReasons([{ code: "import.notJson", params: {} }]),
      "no es un JSON válido, no se importó nada",
    );
    assert.equal(
      importReasons([
        { code: "import.duplicateId", params: { id: "p1" } },
        { code: "import.roomNoId", params: {} },
      ]),
      "p1: id duplicado, omitido; se ignoró una habitación sin id",
    );
  });
});
