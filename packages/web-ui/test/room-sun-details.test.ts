// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { activeSpaceId, emptyData, type AppData, type Plant } from "@green-garden/storage";
import { plantSunText } from "../src/sun-hours.ts";

afterEach(() => {
  setLocale("en-GB");
});

const TODAY = "2026-11-09";
const space = activeSpaceId(emptyData());
const place = { hemisphere: "north" as const, latitude: 55, country: "GB" };
const fern = (extra: Partial<Plant> = {}): Plant => ({
  id: "p1",
  spaceId: space,
  name: "Fern",
  style: "keep_moist",
  intervalDays: 5,
  logs: [],
  source: "catalogue: fern",
  roomId: "r1",
  ...extra,
});
const withRoom = (p: Plant, directSun?: { from: number; to: number }[]): AppData => ({
  ...emptyData(),
  plants: [p],
  rooms: [
    {
      id: "r1",
      name: "Lounge",
      spaceId: space,
      light: "bright_indirect",
      ...(directSun === undefined ? {} : { directSun }),
    },
  ],
});

describe("Details show the sun hours an indoor plant uses, and where they come from", () => {
  it("reads the room's hours as the room's", () => {
    const text = plantSunText(withRoom(fern(), [{ from: 6, to: 11 }]), fern(), TODAY, place);
    assert.match(text ?? "", /from the room/i);
    assert.match(text ?? "", /6:00-11:00/);
  });

  it("a plant's own hours win and read as its own", () => {
    const own = fern({ directSun: [{ from: 13, to: 16 }] });
    const text = plantSunText(withRoom(own, [{ from: 6, to: 11 }]), own, TODAY, place);
    assert.match(text ?? "", /its own/i);
    assert.match(text ?? "", /13:00-16:00/);
    assert.doesNotMatch(text ?? "", /(^|[ :])6:00-11:00/);
  });

  it("says nothing when neither the plant nor its room has an answer", () => {
    assert.equal(plantSunText(withRoom(fern()), fern(), TODAY, place), undefined);
  });

  it("an answered room with no sun reads as hardly any", () => {
    assert.match(plantSunText(withRoom(fern(), []), fern(), TODAY, place) ?? "", /Hardly any/);
  });

  it("is worded in Spanish and Italian too", () => {
    setLocale("es");
    assert.match(
      plantSunText(withRoom(fern(), [{ from: 6, to: 11 }]), fern(), TODAY, place) ?? "",
      /de la habitación/i,
    );
    setLocale("it");
    assert.match(
      plantSunText(withRoom(fern(), [{ from: 6, to: 11 }]), fern(), TODAY, place) ?? "",
      /dalla stanza/i,
    );
  });

  it("the card shows it", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
    assert.match(app, /plantSunText\(data, p, today, sunPlace\(\)\)/);
  });
});

describe("the Direct sun row needs sun hours, not a light level", () => {
  // a plant whose interval the user typed has no catalogue source, so no start facts reach the plan
  const typed = (extra: Partial<Plant> = {}): Plant => {
    return Object.fromEntries(
      Object.entries(fern(extra)).filter(([k]) => k !== "source"),
    ) as unknown as Plant;
  };
  const roomNoLight = (directSun?: { from: number; to: number }[]): AppData => ({
    ...emptyData(),
    plants: [typed()],
    rooms: [
      {
        id: "r1",
        name: "Lounge",
        spaceId: space,
        ...(directSun === undefined ? {} : { directSun }),
      },
    ],
  });

  it("shows a room's sun hours when the room has no light level", () => {
    const text = plantSunText(roomNoLight([{ from: 6, to: 11 }]), typed(), TODAY, place);
    assert.match(text ?? "", /from the room/i);
    assert.match(text ?? "", /6:00-11:00/);
  });

  it("shows a plant's own sun hours when its room has no light level", () => {
    const own = typed({ directSun: [{ from: 13, to: 16 }] });
    const data = { ...roomNoLight(), plants: [own] };
    assert.match(plantSunText(data, own, TODAY, place) ?? "", /its own/i);
  });

  it("shows a plant's own sun hours when it has no room", () => {
    const own = typed({ directSun: [{ from: 13, to: 16 }] });
    const noRoom = Object.fromEntries(
      Object.entries(own).filter(([k]) => k !== "roomId"),
    ) as unknown as Plant;
    const data = { ...emptyData(), plants: [noRoom] };
    assert.match(plantSunText(data, noRoom, TODAY, place) ?? "", /13:00-16:00/);
  });

  it("still says nothing when there are no hours anywhere", () => {
    assert.equal(plantSunText(roomNoLight(), typed(), TODAY, place), undefined);
  });
});
