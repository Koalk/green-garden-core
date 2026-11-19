// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranslator } from "@green-garden/i18n";
import { emptyData, type AppData, type Plant } from "@green-garden/storage";
import {
  amountInputFor,
  amountLines,
  amountPrefs,
  amountText,
  calibrationFromMeasurement,
  DEFAULT_AMOUNT_PREFS,
  type AmountPrefs,
} from "../src/index.ts";

const en = createTranslator("en-GB");
const pot15 = { style: "let_top_dry", potDiameterCm: 15 } as const; // about 350 ml
const precise: AmountPrefs = { ...DEFAULT_AMOUNT_PREFS, mode: "precise" };

describe("amount lines", () => {
  it("the stop point comes first, the amount is secondary and never in ml", () => {
    const a = amountLines(en, pot15, DEFAULT_AMOUNT_PREFS);
    assert.match(a.stop, /^Water until it runs out of the bottom into the saucer/);
    assert.equal(a.amount, "About 1½ mugs (provisional).");
    assert.doesNotMatch(JSON.stringify(a), /\bml\b/);
    assert.equal(amountText(en, pot15), `${a.stop} ${a.amount}`);
  });

  it("qualitative rounds to halves, precise to quarters", () => {
    assert.match(amountLines(en, pot15, precise).amount ?? "", /1½ mugs/);
    const big = { style: "let_top_dry", potDiameterCm: 17 } as const;
    assert.notEqual(amountLines(en, big, DEFAULT_AMOUNT_PREFS).amount ?? "", "");
    assert.match(amountLines(en, big, precise).amount ?? "", /¼|¾|½|\d/);
  });

  it("counts in the user's own container", () => {
    const glass = amountLines(en, pot15, { ...DEFAULT_AMOUNT_PREFS, measure: "glass" }).amount;
    assert.match(glass ?? "", /About 1½ glasses|About 2 glasses/);
    const cup = amountLines(en, pot15, { ...DEFAULT_AMOUNT_PREFS, measure: "cup", wording: "us" });
    assert.match(cup.amount ?? "", /cups/);
  });

  it("measure none hides the amount, and no pot size means no amount", () => {
    const none = { ...DEFAULT_AMOUNT_PREFS, measure: "none" } as const;
    assert.equal(amountLines(en, pot15, none).amount, undefined);
    assert.equal(amountLines(en, { style: "keep_moist" }, DEFAULT_AMOUNT_PREFS).amount, undefined);
  });

  it("a very big pot gives the stop point only (more than three containers)", () => {
    const huge = { style: "let_fully_dry", potDiameterCm: 45 } as const;
    assert.equal(amountLines(en, huge, DEFAULT_AMOUNT_PREFS).amount, undefined);
  });

  it("US wording says dump, UK says tip out, in the translator's own locale", () => {
    const style = { style: "keep_moist" } as const;
    assert.match(amountLines(en, style, DEFAULT_AMOUNT_PREFS).stop, /Tip out the saucer/);
    assert.match(
      amountLines(en, style, { ...DEFAULT_AMOUNT_PREFS, wording: "us" }).stop,
      /Dump the saucer/,
    );
    // a locale with no ".us" variant falls back to the plain key
    const es = createTranslator("es");
    assert.doesNotMatch(
      amountLines(es, style, { ...DEFAULT_AMOUNT_PREFS, wording: "us" }).stop,
      /^amount\./,
    );
  });

  it("a pot with no hole: tiny amount, a warning and the cachepot tip", () => {
    const a = amountLines(en, { ...pot15, drainage: "no_hole" }, DEFAULT_AMOUNT_PREFS);
    assert.match(a.warning ?? "", /cannot drain/);
    assert.match(a.tip ?? "", /pot with holes/);
    assert.doesNotMatch(a.stop, /runs out of the bottom/);
    assert.ok((a.amount ?? "").length > 0);
    assert.doesNotMatch(a.amount ?? "", /1½/);
  });

  it("a cachepot and a self-watering pot get their own instruction and no amount", () => {
    const c = amountLines(en, { ...pot15, drainage: "cachepot" }, DEFAULT_AMOUNT_PREFS);
    assert.match(c.stop, /Lift the inner pot out/);
    assert.equal(c.amount, undefined);
    const s = amountLines(en, { ...pot15, drainage: "self_watering" }, DEFAULT_AMOUNT_PREFS);
    assert.match(s.stop, /reservoir/);
    assert.equal(s.amount, undefined);
  });

  it("is worded in Spanish and Italian", () => {
    const es = amountLines(createTranslator("es"), pot15, DEFAULT_AMOUNT_PREFS);
    assert.match(es.amount ?? "", /Aproximadamente 1½ tazas/);
    const it = amountLines(createTranslator("it"), pot15, DEFAULT_AMOUNT_PREFS);
    assert.match(it.amount ?? "", /Circa 1½ tazze/);
  });
});

describe("precise mode shows an estimated ml", () => {
  it("before any calibration: quarters of the container plus an ml figure labelled estimate", () => {
    const a = amountLines(en, pot15, precise);
    assert.equal(a.basis, undefined);
    assert.equal(a.amount, "About 1½ mugs (about 350 ml, estimate) (provisional).");
  });

  it("the ml figure is there for any pot with a size", () => {
    const big = { style: "let_top_dry", potDiameterCm: 17 } as const;
    assert.match(amountLines(en, big, precise).amount ?? "", /\d+ ml, estimate\)/);
  });

  it("qualitative mode still never shows ml", () => {
    assert.doesNotMatch(JSON.stringify(amountLines(en, pot15, DEFAULT_AMOUNT_PREFS)), /\bml\b/);
  });

  it("once calibrated the ml is the user's own figure and is not labelled estimate", () => {
    const a = amountLines(en, { ...pot15, calibration: { plant: { measuredMl: 300 } } }, precise);
    assert.equal(a.basis, "plant");
    assert.match(a.amount ?? "", /about 300 ml/);
    assert.doesNotMatch(a.amount ?? "", /estimate/);
  });

  it("a no-hole pot shows its own, smaller estimate", () => {
    const a = amountLines(en, { ...pot15, drainage: "no_hole" }, precise).amount ?? "";
    assert.match(a, /about 140 ml, estimate/);
  });

  it("measure none and cachepots stay without an amount", () => {
    assert.equal(amountLines(en, pot15, { ...precise, measure: "none" }).amount, undefined);
    assert.equal(amountLines(en, { ...pot15, drainage: "cachepot" }, precise).amount, undefined);
  });

  it("is worded in Spanish and Italian", () => {
    assert.match(amountLines(createTranslator("es"), pot15, precise).amount ?? "", /estimación/);
    assert.match(amountLines(createTranslator("it"), pot15, precise).amount ?? "", /stima/);
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

describe("amountInputFor and calibrationFromMeasurement", () => {
  it("collects plant, room and global calibration for one plant", () => {
    const d = emptyData();
    const plant = { ...pot15, id: "p1", roomId: "r1", calibration: { measuredMl: 300 } };
    const data = {
      ...d,
      rooms: [{ id: "r1", name: "Kitchen", calibration: { factor: 1.2 } }],
      settings: { ...d.settings, calibration: { factor: 0.9 } },
    };
    const input = amountInputFor(data as never, plant as never);
    assert.deepEqual(input.calibration, {
      plant: { measuredMl: 300 },
      room: { factor: 1.2 },
      global: { factor: 0.9 },
    });
  });

  it("a plant measurement is the amount; a room one is a factor against the estimate", () => {
    assert.deepEqual(calibrationFromMeasurement("plant", pot15, 300), { measuredMl: 300 });
    const f = calibrationFromMeasurement("room", pot15, 700);
    assert.ok(f !== undefined && "factor" in f && Math.abs(f.factor - 2) < 0.05);
    assert.equal(calibrationFromMeasurement("plant", pot15, 0), undefined);
  });
});

describe("the clamp moves into the amount", () => {
  const catalogue = { fieldSources: { intervalDays: "catalogue" } } as const;
  const dataFor = (light: "direct" | "low" | "medium", plant: object): [AppData, Plant] => {
    const d = emptyData();
    const p = {
      id: "p1",
      spaceId: "space1",
      name: "P",
      style: "let_top_dry",
      intervalDays: 10,
      roomId: "r1",
      potDiameterCm: 15,
      logs: [],
      ...catalogue,
      ...plant,
    } as Plant;
    return [{ ...d, plants: [p], rooms: [{ id: "r1", name: "Sun", spaceId: "space1", light }] }, p];
  };

  it("a pot the low clamp holds back gets more water each time, in plain words", () => {
    const [d, p] = dataFor("direct", {});
    const input = amountInputFor(d, p);
    assert.equal(input.amountFactor, 1.5);
    const a = amountLines(en, input, DEFAULT_AMOUNT_PREFS);
    assert.equal(a.amount, "About 2 mugs (provisional).");
    assert.equal(a.adjustNote, "A bit more water each time.");
  });

  it("a pot held back at the top gets less each time", () => {
    const [d, p] = dataFor("low", { potDiameterCm: 20 });
    const a = amountLines(en, amountInputFor(d, p), DEFAULT_AMOUNT_PREFS);
    assert.equal(a.adjustNote, "A bit less water each time.");
  });

  it("nothing is clipped: no correction and no extra line", () => {
    const [d, p] = dataFor("medium", {});
    const input = amountInputFor(d, p);
    assert.equal(input.amountFactor, undefined);
    assert.equal(amountLines(en, input, DEFAULT_AMOUNT_PREFS).adjustNote, undefined);
  });

  it("an interval the user typed is left alone, so is its amount", () => {
    const [d, p] = dataFor("direct", { fieldSources: { intervalDays: "user" } });
    assert.equal(amountInputFor(d, p).amountFactor, undefined);
  });

  it("is worded in Spanish and Italian", () => {
    const [d, p] = dataFor("direct", {});
    const input = amountInputFor(d, p);
    assert.match(
      amountLines(createTranslator("es"), input, DEFAULT_AMOUNT_PREFS).adjustNote ?? "",
      /más de agua cada vez/,
    );
    assert.match(
      amountLines(createTranslator("it"), input, DEFAULT_AMOUNT_PREFS).adjustNote ?? "",
      /più d'acqua ogni volta/,
    );
  });
});
