// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, type AppData, type Plant } from "@green-garden/storage";
import {
  ROOM_PREFIX,
  answerQuestion,
  nextForSitting,
  questionFor,
  roomIsWaiting,
  snoozeQuestion,
} from "../src/improve.ts";

// Q-SUNHOURS for a room target: asked once per room with the window wording, after the room's
// light; an indoor plant without its own hours takes the room's (the plan side is in storage).

const TODAY = "2026-11-03";
const plant = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: `Plant ${id}`,
  style: "let_top_dry",
  intervalDays: 7,
  logs: [],
  roomId: "r1",
  ...extra,
});
const room = (extra: object = {}) => ({
  id: "r1",
  name: "Kitchen",
  spaceId: DEFAULT_SPACE_ID,
  light: "medium" as const,
  ...extra,
});
const dataOf = (rooms: object[], plants: Plant[] = [plant("a")]): AppData =>
  ({
    spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
    plants,
    rooms,
    settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
  }) as unknown as AppData;
const target = `${ROOM_PREFIX}r1`;

describe("room sun hours question", () => {
  it("a lit room with plants and no sun answer waits, and the question is Q-SUNHOURS", () => {
    const d = dataOf([room()]);
    assert.equal(roomIsWaiting(d, "r1", TODAY), true);
    assert.equal(questionFor(d, target, TODAY)?.id, "Q-SUNHOURS");
  });

  it("the room's light comes first", () => {
    const d = dataOf([room({ light: undefined })]);
    assert.equal(questionFor(d, target, TODAY)?.id, "Q-ROOMLIGHT");
  });

  it("an answered room, even with none, stops waiting", () => {
    assert.equal(roomIsWaiting(dataOf([room({ directSun: [] })]), "r1", TODAY), false);
    assert.equal(
      roomIsWaiting(dataOf([room({ directSun: [{ from: 8, to: 12 }] })]), "r1", TODAY),
      false,
    );
  });

  it("a room with no plants does not wait", () => {
    assert.equal(roomIsWaiting(dataOf([room()], []), "r1", TODAY), false);
  });

  it("the sitting offers it once per room, not once per plant", () => {
    const d = dataOf([room()], [plant("a"), plant("b")]);
    const ask = nextForSitting(d, TODAY, 0, ["a", "b"]);
    assert.ok(ask);
    assert.equal(ask.target, target);
    assert.equal(ask.question.id, "Q-SUNHOURS");
  });

  it("an indoor plant is never asked its own, even with no room", () => {
    const loose: Plant = { ...plant("a"), placement: "indoor" };
    delete (loose as { roomId?: string }).roomId;
    const d = dataOf([room()], [loose]);
    const ids = nextForSitting(d, TODAY, 0)?.question.id;
    assert.notEqual(ids, "Q-SUNHOURS");
  });

  it("each preset sets the room's hours; the hours are not a plant field", () => {
    const d = dataOf([room()]);
    const at = (v: string) => answerQuestion(d, target, "Q-SUNHOURS", v, TODAY);
    assert.deepEqual(at("morning").rooms[0]?.directSun, [{ from: 6, to: 11 }]);
    assert.deepEqual(at("afternoon").rooms[0]?.directSun, [{ from: 15, to: 19 }]);
    assert.deepEqual(at("morning_afternoon").rooms[0]?.directSun, [
      { from: 7, to: 11 },
      { from: 15, to: 18 },
    ]);
    assert.deepEqual(at("none").rooms[0]?.directSun, []);
    assert.equal(at("morning").plants[0]?.directSun, undefined);
  });

  it("'not sure' snoozes the question and junk changes nothing", () => {
    const d = dataOf([room()]);
    const sure = answerQuestion(d, target, "Q-SUNHOURS", "not_sure", TODAY);
    assert.equal(sure.rooms[0]?.directSun, undefined);
    assert.equal(roomIsWaiting(sure, "r1", TODAY), false);
    assert.equal(answerQuestion(d, target, "Q-SUNHOURS", "sideways", TODAY), d);
    assert.equal(
      answerQuestion(d, target, "Q-ROOMLIGHT", "morning", TODAY).rooms[0]?.light,
      "medium",
    );
  });

  it("the answer from the room sheet works for a room without light as well", () => {
    const d = dataOf([room({ light: undefined })]);
    const next = answerQuestion(d, target, "Q-SUNHOURS", "midday", TODAY);
    assert.deepEqual(next.rooms[0]?.directSun, [{ from: 11, to: 15 }]);
    assert.equal(next.rooms.at(0)?.light, undefined);
  });

  it("snoozing the sun question leaves the light question alone", () => {
    const d = snoozeQuestion(dataOf([room({ light: undefined })]), target, "Q-SUNHOURS", TODAY);
    assert.equal(questionFor(d, target, TODAY)?.id, "Q-ROOMLIGHT");
  });
});
