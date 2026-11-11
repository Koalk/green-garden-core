// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import { addPlant } from "../src/actions.ts";
import { modalHtml } from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const opts = (fields: Record<string, string>, plantId?: string) => ({
  fields,
  rooms: [],
  title: "Edit",
  ...(plantId === undefined ? {} : { plantId }),
});

describe("'Had it since' in the plant dialog", () => {
  it("the edit form has a date field with the plant's day", () => {
    const html = modalHtml(opts({ addedOn: "2026-03-01" }, "p1"));
    assert.match(html, /Had it since <input name="addedOn" type="date"[^>]*value="2026-03-01"/);
  });
  it("an estimated day says 'about'", () => {
    const html = modalHtml(opts({ addedOn: "2026-03-01", addedOnEstimated: "1" }, "p1"));
    assert.match(html, /Had it since \(about\) <input name="addedOn"/);
  });
  it("the add form does not ask (the day is today)", () => {
    assert.doesNotMatch(modalHtml(opts({})), /name="addedOn"/);
  });
  it("es and it have their own wording", () => {
    setLocale("es");
    assert.doesNotMatch(modalHtml(opts({}, "p1")), /Had it since/);
    assert.match(modalHtml(opts({}, "p1")), /name="addedOn"/);
    setLocale("it");
    assert.doesNotMatch(modalHtml(opts({}, "p1")), /Had it since/);
  });
});

describe("addPlant sets addedOn", () => {
  it("a new plant gets today, a given day is kept", () => {
    const plant = { name: "A", style: "let_top_dry" as const, intervalDays: 7, logs: [] };
    assert.equal(addPlant(emptyData(), plant, "2026-11-09").plants[0]?.addedOn, "2026-11-09");
    assert.equal(
      addPlant(emptyData(), { ...plant, addedOn: "2026-01-01" }, "2026-11-09").plants[0]?.addedOn,
      "2026-01-01",
    );
    assert.equal(addPlant(emptyData(), plant).plants[0]?.addedOn, undefined);
  });
});
