// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { addPlant } from "../src/actions.ts";
import { emptyData } from "@green-garden/storage";
import { modalHtml } from "../src/modal.ts";
import { defaultPlacementFor, placementNeedsHome } from "../src/placement.ts";

afterEach(() => {
  setLocale("en-GB");
});

const opts = (fields: Record<string, string>) => ({ fields, rooms: [], title: "Add" });

describe("placement chips in the add-plant dialog", () => {
  it("shows three chips, with Indoors pressed when nothing is set", () => {
    const html = modalHtml(opts({}));
    assert.match(html, /name="placement" value="indoor"/);
    for (const [v, label] of [
      ["indoor", "Indoors"],
      ["outdoor_pot", "Pot outside"],
      ["ground", "In the ground"],
    ] as const) {
      assert.match(
        html,
        new RegExp(
          `data-action="placement-chip" data-value="${v}" aria-pressed="${v === "indoor"}">${label}<`,
        ),
      );
    }
  });

  it("presses the chip of the plant being edited", () => {
    const html = modalHtml(opts({ placement: "ground" }));
    assert.match(html, /name="placement" value="ground"/);
    assert.match(html, /data-value="ground" aria-pressed="true"/);
    assert.match(html, /data-value="indoor" aria-pressed="false"/);
  });

  it("es and it have their own wording", () => {
    setLocale("es");
    assert.doesNotMatch(modalHtml(opts({})), />Indoors</);
    setLocale("it");
    assert.doesNotMatch(modalHtml(opts({})), />Pot outside</);
  });

  it("defaults to the catalogue entry's placement, else indoors", () => {
    assert.equal(defaultPlacementFor(undefined), "indoor");
    assert.equal(defaultPlacementFor({ tags: ["indoor", "fern"] }), "indoor");
    assert.equal(defaultPlacementFor({ tags: ["garden_bed", "flowering"] }), "ground");
  });
});

describe("placement and the Q-K0 gate", () => {
  const data = addPlant(emptyData(), {
    name: "Fern",
    style: "let_top_dry",
    intervalDays: 7,
    logs: [],
  });

  it("an outdoor chip with no climate asks Q-K0 first, through the existing rule", () => {
    assert.equal(placementNeedsHome(data, "ground"), true);
    assert.equal(placementNeedsHome(data, "outdoor_pot"), true);
  });

  it("indoors never asks, and neither does an outdoor chip once a climate is set", () => {
    assert.equal(placementNeedsHome(data, "indoor"), false);
    const withClimate = {
      ...data,
      settings: { ...data.settings, climate: "oceanic_wet" as const },
    };
    assert.equal(placementNeedsHome(withClimate, "ground"), false);
  });
});
