// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData, type AppData } from "@green-garden/storage";
import {
  DEFAULT_AMOUNT_PREFS,
  addRoom,
  amountLines,
  calibrationFromMeasurement,
  calibrationHtml,
  calibrationsFor,
  modalHtml,
  setCalibration,
} from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const pot15 = { style: "let_top_dry", potDiameterCm: 15 } as const; // 350 ml, 1.4 mugs

function home(): AppData {
  const d = addRoom(emptyData(), "Kitchen");
  return {
    ...d,
    plants: [
      {
        id: "p1",
        spaceId: "space1",
        name: "Fern",
        roomId: "r1",
        style: "let_top_dry",
        intervalDays: 7,
        potDiameterCm: 15,
        logs: [],
      },
      {
        id: "p2",
        spaceId: "space1",
        name: "Aloe",
        style: "let_fully_dry",
        intervalDays: 14,
        potDiameterCm: 12,
        logs: [],
      },
    ],
  };
}

describe("which calibration applies to a plant", () => {
  it("collects the plant, room and global levels, leaving out what is not set", () => {
    const d = setCalibration(
      setCalibration(
        setCalibration(home(), { kind: "global" }, { factor: 2 }),
        { kind: "room", id: "r1" },
        { factor: 0.5 },
      ),
      { kind: "plant", id: "p1" },
      { measuredMl: 500 },
    );
    assert.deepEqual(calibrationsFor(d, d.plants[0] as AppData["plants"][number]), {
      global: { factor: 2 },
      room: { factor: 0.5 },
      plant: { measuredMl: 500 },
    });
    assert.deepEqual(calibrationsFor(d, d.plants[1] as AppData["plants"][number]), {
      global: { factor: 2 },
    });
  });

  it("reset removes the level and leaves no empty key behind", () => {
    const set = setCalibration(home(), { kind: "plant", id: "p1" }, { measuredMl: 500 });
    assert.equal(set.plants[0]?.calibration?.measuredMl, 500);
    const gone = setCalibration(set, { kind: "plant", id: "p1" }, undefined);
    assert.equal("calibration" in (gone.plants[0] ?? {}), false);
    const room = setCalibration(
      setCalibration(home(), { kind: "room", id: "r1" }, { factor: 2 }),
      { kind: "room", id: "r1" },
      undefined,
    );
    assert.equal("calibration" in (room.rooms[0] ?? {}), false);
    const global = setCalibration(
      setCalibration(home(), { kind: "global" }, { factor: 2 }),
      { kind: "global" },
      undefined,
    );
    assert.equal("calibration" in global.settings, false);
    assert.equal(
      setCalibration(home(), { kind: "plant", id: "nope" }, { factor: 2 }).plants.length,
      2,
    );
  });
});

describe("turning a measurement into a calibration", () => {
  it("per plant it is the measured amount itself", () => {
    assert.deepEqual(calibrationFromMeasurement("plant", pot15, 420), { measuredMl: 420 });
  });

  it("for a room or everywhere it is a factor against what the test pot was estimated at", () => {
    assert.deepEqual(calibrationFromMeasurement("room", pot15, 700), { factor: 2 });
    assert.deepEqual(calibrationFromMeasurement("global", pot15, 175), { factor: 0.5 });
  });

  it("gives nothing for a bad measurement, or a factor from a pot with no estimate", () => {
    assert.equal(calibrationFromMeasurement("plant", pot15, 0), undefined);
    assert.equal(calibrationFromMeasurement("plant", pot15, Number.NaN), undefined);
    assert.equal(calibrationFromMeasurement("room", { style: "keep_moist" }, 300), undefined);
    assert.deepEqual(calibrationFromMeasurement("plant", { style: "keep_moist" }, 300), {
      measuredMl: 300,
    });
  });
});

describe("the amount text says where it came from", () => {
  it("uncalibrated: a quiet line asking to measure it once, no level", () => {
    const a = amountLines(pot15, DEFAULT_AMOUNT_PREFS);
    assert.equal(a.basis, undefined);
    assert.equal(a.note, "Measure it once for a better estimate.");
  });

  it("calibrated: names the level instead, in each of the three", () => {
    const cal = (c: object) => amountLines({ ...pot15, calibration: c }, DEFAULT_AMOUNT_PREFS);
    assert.equal(cal({ plant: { measuredMl: 500 } }).basis, "plant");
    assert.match(cal({ plant: { measuredMl: 500 } }).note ?? "", /this plant/);
    assert.match(cal({ room: { factor: 2 } }).note ?? "", /this room/);
    assert.match(cal({ global: { factor: 2 } }).note ?? "", /everywhere|all your plants/);
    assert.equal(cal({ plant: { measuredMl: 500 } }).amount, "About 2 mugs (provisional).");
  });

  it("precise mode shows ml: an estimate before calibration, the user's own figure after", () => {
    const precise = { ...DEFAULT_AMOUNT_PREFS, mode: "precise" } as const;
    assert.match(amountLines(pot15, precise).amount ?? "", /about 350 ml, estimate\)/);
    const c = amountLines({ ...pot15, calibration: { plant: { measuredMl: 420 } } }, precise);
    assert.match(c.amount ?? "", /about 400 ml\)/);
    assert.doesNotMatch(c.amount ?? "", /estimate/);
    const q = amountLines(
      { ...pot15, calibration: { plant: { measuredMl: 420 } } },
      DEFAULT_AMOUNT_PREFS,
    );
    assert.doesNotMatch(q.amount ?? "", /ml/, "qualitative mode never shows ml");
  });

  it("is worded in Spanish", () => {
    setLocale("es");
    assert.match(amountLines(pot15, DEFAULT_AMOUNT_PREFS).note ?? "", /Mídelo una vez/);
  });
});

describe("the settings section and the plant dialog", () => {
  it("settings: the steps, a form for the three levels, and a reset for each level that is set", () => {
    const html = calibrationHtml(home());
    assert.match(html, /id="calibration"/);
    assert.match(html, /data-form="calibration"/);
    assert.match(html, /name="level"/);
    assert.match(html, /value="global"/);
    assert.match(html, /value="room"/);
    assert.match(html, /value="plant"/);
    assert.doesNotMatch(html, /data-action="reset-calibration"/, "nothing to reset yet");
    const set = setCalibration(home(), { kind: "plant", id: "p1" }, { measuredMl: 420 });
    assert.match(
      calibrationHtml(set),
      /data-action="reset-calibration" data-level="plant" data-id="p1"/,
    );
  });

  it("the plant dialog carries the quiet line and nothing louder", () => {
    const html = modalHtml({
      fields: {},
      rooms: [],
      title: "x",
      amountNote: "Measure it once for a better estimate.",
    });
    assert.match(
      html,
      /<p class="quiet"><small>Measure it once for a better estimate\.<\/small><\/p>/,
    );
    assert.doesNotMatch(html, /role="alert"[^>]*>Measure/);
  });

  it("app.ts shows the line on the plant card and has no pop-up, badge or reminder for it", async () => {
    const { readFileSync } = await import("node:fs");
    const src = ["app.ts", "settings-view.ts"]
      .map((f) => readFileSync(`${import.meta.dirname}/../src/${f}`, "utf8"))
      .join("\n");
    assert.match(src, /amountInputFor\(/);
    assert.match(src, /calibrationHtml\(/);
    assert.match(src, /reset-calibration/);
    assert.doesNotMatch(src, /calibrat[^\n]*(confirm|alert|badge)/i);
  });
});
