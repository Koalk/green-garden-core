// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { t } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import { setHome } from "../src/index.ts";

describe("home region", () => {
  it("sets and clears the country, and leaves everything else alone", () => {
    const d = emptyData();
    const es = setHome(d, "ES");
    assert.equal(es.settings.country, "ES");
    assert.equal(es.settings.hemisphere, d.settings.hemisphere);
    const cleared = setHome(es, undefined);
    assert.equal("country" in cleared.settings, false);
    assert.equal("country" in setHome(es, "auto").settings, false);
  });

  it("an unknown value is not stored", () => {
    assert.equal("country" in setHome(emptyData(), "FR").settings, false);
  });

  it("keeps a latitude someone put in the file, whatever the country select says", () => {
    const d = emptyData();
    const withLat = { ...d, settings: { ...d.settings, latitude: 41.4 } };
    assert.equal(setHome(withLat, "GB").settings.latitude, 41.4);
  });

  it("the Settings form has the select and saves it with the other settings", () => {
    const src = readFileSync(`${import.meta.dirname}/../src/settings-view.ts`, "utf8");
    assert.match(src, /name="country"/);
    assert.match(src, /setHome\(/);
    assert.equal(t("settings.country"), "Where is home?");
    assert.equal(t("settings.countryOption.GB"), "UK (about 55° N)");
    assert.equal(t("settings.countryOption.ES"), "Spain (about 40° N)");
  });
});
