// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData, type AppData } from "@green-garden/storage";
import { addRoom, areaChecklistHtml, haFailureText, importRooms } from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const areas = [
  { id: "bedroom", name: "Bedroom" },
  { id: "kitchen", name: "Kitchen" },
  { id: "living_room", name: "Living Room" },
];

describe("importRooms", () => {
  it("adds only the ticked areas, with their area id and in the active space", () => {
    const d = importRooms(emptyData(), areas, ["kitchen", "living_room"]);
    assert.deepEqual(
      d.rooms.map((r) => [r.name, r.haAreaId, r.spaceId]),
      [
        ["Kitchen", "kitchen", "space1"],
        ["Living Room", "living_room", "space1"],
      ],
    );
    assert.deepEqual(
      d.rooms.map((r) => r.id),
      ["r1", "r2"],
    );
  });

  it("links an existing room of the same name (any case) to its area, changing nothing else", () => {
    const start = addRoom(addRoom(emptyData(), "kitchen"), "Hall");
    const d = importRooms(start, areas, ["kitchen", "bedroom"]);
    assert.deepEqual(
      d.rooms.map((r) => [r.id, r.name, r.haAreaId]),
      [
        ["r1", "kitchen", "kitchen"],
        ["r2", "Hall", undefined],
        ["r3", "Bedroom", "bedroom"],
      ],
    );
  });

  it("never re-links a room that already has an area id", () => {
    const base = addRoom(emptyData(), "Kitchen");
    const start: AppData = {
      ...base,
      rooms: base.rooms.map((r) => ({ ...r, haAreaId: "old_kitchen" })),
    };
    assert.equal(importRooms(start, areas, ["kitchen"]), start);
  });

  it("deletes nothing, ignores unknown ids and gives the same data back when nothing is added", () => {
    const start = addRoom(emptyData(), "Hall");
    assert.equal(importRooms(start, areas, []), start);
    assert.equal(importRooms(start, areas, ["nope"]), start);
    assert.equal(importRooms(start, areas, ["bedroom"]).rooms.length, 2);
  });

  it("does not add the same area twice in one go", () => {
    assert.equal(importRooms(emptyData(), areas, ["kitchen", "kitchen"]).rooms.length, 1);
  });

  it("a room with the same name in another space does not count as existing", () => {
    const base = emptyData();
    const d: AppData = {
      ...base,
      spaces: [...base.spaces, { id: "space2", name: "Office", awayDates: [] }],
      rooms: [{ id: "r1", name: "Kitchen", spaceId: "space2" }],
    };
    assert.equal(importRooms(d, areas, ["kitchen"]).rooms.length, 2);
  });
});

describe("areaChecklistHtml", () => {
  it("lists every area as a checkbox, and marks the ones that are rooms already", () => {
    const html = areaChecklistHtml(areas, addRoom(emptyData(), "Kitchen"));
    assert.equal([...html.matchAll(/name="area"/g)].length, 3);
    assert.doesNotMatch(html, /value="kitchen"[^>]*disabled/);
    assert.match(html, /will be linked/);
    const linked: AppData = {
      ...addRoom(emptyData(), "Kitchen"),
      rooms: [{ id: "r1", name: "Kitchen", spaceId: "space1", haAreaId: "kitchen" }],
    };
    const done = areaChecklistHtml(areas, linked);
    assert.match(done, /value="kitchen"[^>]*disabled/);
    assert.match(done, /already a room/);
    assert.doesNotMatch(html, /value="bedroom"[^>]*disabled/);
    assert.match(html, /data-form="ha-rooms"/);
  });

  it("escapes names and says so when Home Assistant has no areas", () => {
    const html = areaChecklistHtml([{ id: "x", name: '<b>"Bad"</b>' }], emptyData());
    assert.doesNotMatch(html, /<b>/);
    assert.match(areaChecklistHtml([], emptyData()), /no areas/i);
  });
});

describe("what the user is told when it does not work", () => {
  it("not configured says where to put the address and the token", () => {
    const text = haFailureText("not_configured");
    assert.match(text, /GREEN_GARDEN_HA_URL/);
    assert.match(text, /GREEN_GARDEN_HA_TOKEN/);
    assert.match(text, /\.env/);
  });

  it("each failure has its own wording, in each language", () => {
    for (const locale of ["en-GB", "es", "it"]) {
      setLocale(locale);
      const texts = (
        ["not_configured", "unauthorised", "unreachable", "bad_response"] as const
      ).map(haFailureText);
      assert.equal(new Set(texts).size, 4, locale);
      assert.ok(
        texts.every((x) => !x.startsWith("ha.")),
        "no raw key",
      );
    }
  });
});

describe("app.ts wiring", () => {
  it("has the button, asks the proxy, and never names the token", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
    assert.match(src, /data-action="ha-areas"/);
    assert.match(src, /new ProxyAreas\(/);
    assert.match(src, /areaChecklistHtml\(/);
    assert.doesNotMatch(src, /GREEN_GARDEN_HA_TOKEN|Bearer/);
  });
});
