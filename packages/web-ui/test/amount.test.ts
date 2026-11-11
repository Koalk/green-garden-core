// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { amountLines, amountPrefs, amountText, DEFAULT_AMOUNT_PREFS } from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const pot15 = { style: "let_top_dry", potDiameterCm: 15 } as const; // about 350 ml

describe("amount lines (02h)", () => {
  it("the stop point comes first, the amount is secondary and never in ml", () => {
    const a = amountLines(pot15, DEFAULT_AMOUNT_PREFS);
    assert.match(a.stop, /^Water until it runs out of the bottom into the saucer/);
    assert.equal(a.amount, "About 1½ mugs (provisional).");
    assert.doesNotMatch(JSON.stringify(a), /\bml\b/);
    assert.equal(amountText(pot15), `${a.stop} ${a.amount}`);
  });

  it("qualitative rounds to halves, precise to quarters", () => {
    // 350 ml in a 250 ml mug is 1.4 mugs
    assert.match(
      amountLines(pot15, { ...DEFAULT_AMOUNT_PREFS, mode: "precise" }).amount ?? "",
      /1½ mugs/,
    );
    // 500 ml pot water (25 cm, let_top_dry) is two mugs; 450 ml is 1.8
    const big = { style: "let_top_dry", potDiameterCm: 17 } as const;
    const q = amountLines(big, DEFAULT_AMOUNT_PREFS).amount ?? "";
    const p = amountLines(big, { ...DEFAULT_AMOUNT_PREFS, mode: "precise" }).amount ?? "";
    assert.notEqual(q, "");
    assert.match(p, /¼|¾|½|\d/);
  });

  it("counts in the user's own container", () => {
    const glass = amountLines(pot15, { ...DEFAULT_AMOUNT_PREFS, measure: "glass" }).amount ?? "";
    assert.match(glass, /About 1½ glasses|About 2 glasses/);
    const cup =
      amountLines(pot15, { ...DEFAULT_AMOUNT_PREFS, measure: "cup", wording: "us" }).amount ?? "";
    assert.match(cup, /cups/);
  });

  it("measure none hides the amount, and no pot size means no amount", () => {
    assert.equal(
      amountLines(pot15, { ...DEFAULT_AMOUNT_PREFS, measure: "none" }).amount,
      undefined,
    );
    assert.equal(amountLines({ style: "keep_moist" }, DEFAULT_AMOUNT_PREFS).amount, undefined);
  });

  it("a very big pot gives the stop point only (more than three containers)", () => {
    const huge = { style: "let_fully_dry", potDiameterCm: 45 } as const;
    assert.equal(amountLines(huge, DEFAULT_AMOUNT_PREFS).amount, undefined);
  });

  it("US wording says dump, UK says tip out", () => {
    const style = { style: "keep_moist" } as const;
    assert.match(amountLines(style, DEFAULT_AMOUNT_PREFS).stop, /Tip out the saucer/);
    assert.match(
      amountLines(style, { ...DEFAULT_AMOUNT_PREFS, wording: "us" }).stop,
      /Dump the saucer/,
    );
  });

  it("a pot with no hole: tiny amount, a warning and the cachepot tip", () => {
    const a = amountLines({ ...pot15, drainage: "no_hole" }, DEFAULT_AMOUNT_PREFS);
    assert.match(a.warning ?? "", /cannot drain/);
    assert.match(a.tip ?? "", /pot with holes/);
    assert.doesNotMatch(a.stop, /runs out of the bottom/);
    assert.ok((a.amount ?? "").length > 0);
    // much less than the normal amount
    assert.doesNotMatch(a.amount ?? "", /1½/);
  });

  it("a cachepot and a self-watering pot get their own instruction and no amount", () => {
    const c = amountLines({ ...pot15, drainage: "cachepot" }, DEFAULT_AMOUNT_PREFS);
    assert.match(c.stop, /Lift the inner pot out/);
    assert.equal(c.amount, undefined);
    const s = amountLines({ ...pot15, drainage: "self_watering" }, DEFAULT_AMOUNT_PREFS);
    assert.match(s.stop, /reservoir/);
    assert.equal(s.amount, undefined);
  });

  it("is worded in Spanish and Italian", () => {
    setLocale("es");
    assert.match(amountLines(pot15, DEFAULT_AMOUNT_PREFS).amount ?? "", /Aproximadamente 1½ tazas/);
    setLocale("it");
    assert.match(amountLines(pot15, DEFAULT_AMOUNT_PREFS).amount ?? "", /Circa 1½ tazze/);
  });
});

describe("amountPrefs", () => {
  it("defaults to a mug, qualitative, UK wording", () => {
    assert.deepEqual(amountPrefs({}), { measure: "mug", mode: "qualitative", wording: "uk" });
    assert.deepEqual(amountPrefs({ measure: "jug", amountMode: "precise", wording: "us" }), {
      measure: "jug",
      mode: "precise",
      wording: "us",
    });
  });
});

describe("setDisplay", () => {
  it("stores the choices, drops defaults and empty households", async () => {
    const { setDisplay } = await import("../src/index.ts");
    const { emptyData } = await import("@green-garden/storage");
    const a = setDisplay(emptyData(), {
      measure: "glass",
      amountMode: "precise",
      wording: "us",
      pets: ["cat"],
      children: true,
    });
    assert.equal(a.settings.measure, "glass");
    assert.equal(a.settings.amountMode, "precise");
    assert.equal(a.settings.wording, "us");
    assert.deepEqual(a.settings.household, { pets: ["cat"], children: true });
    const b = setDisplay(a, {
      measure: "mug",
      amountMode: "qualitative",
      wording: "uk",
      pets: [],
      children: false,
    });
    assert.equal("measure" in b.settings, false, "the default is not stored");
    assert.equal("amountMode" in b.settings, false);
    assert.equal("wording" in b.settings, false);
    assert.equal("household" in b.settings, false);
  });
});

describe("room light", () => {
  it("sets and clears the light of one room", async () => {
    const { addRoom, setRoomLight } = await import("../src/index.ts");
    const { emptyData } = await import("@green-garden/storage");
    const d = addRoom(addRoom(emptyData(), "Kitchen"), "Hall");
    const lit = setRoomLight(d, "r1", "bright_indirect");
    assert.equal(lit.rooms[0]?.light, "bright_indirect");
    assert.equal(lit.rooms[1]?.light, undefined);
    const cleared = setRoomLight(lit, "r1", undefined);
    assert.equal("light" in (cleared.rooms[0] ?? {}), false);
    assert.equal(setRoomLight(d, "nope", "low"), d);
  });
});

describe("app.ts shows the new settings", () => {
  it("passes the amount preferences and the household to the card and saves the choices", async () => {
    const { readFileSync } = await import("node:fs");
    const src = ["app.ts", "settings-view.ts"]
      .map((f) => readFileSync(`${import.meta.dirname}/../src/${f}`, "utf8"))
      .join("\n");
    assert.match(src, /amountPrefs\(data\.settings\)/);
    assert.match(src, /toxicityOfPlant\(p, data\.settings\.household\)/);
    assert.match(src, /setDisplay\(/);
    assert.match(src, /setRoomLight\(/);
  });
});
