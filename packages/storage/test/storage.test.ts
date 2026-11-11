// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BrowserStore,
  DEFAULT_SPACE_ID,
  migrate,
  VERSION,
  MemoryStore,
  emptyData,
  exportData,
  importData,
  type AppData,
  type KeyValue,
} from "../src/index.ts";

const sample: AppData = {
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: ["2026-11-03"] }],
  plants: [
    {
      id: "p1",
      spaceId: DEFAULT_SPACE_ID,
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-10-30",
      addedOn: "2026-09-01",
      roomId: "r1",
      potDiameterCm: 14,
      logs: [{ date: "2026-10-30", outcome: "done" }],
    },
  ],
  rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
  settings: {
    hemisphere: "south",
    horizonDays: 14,
    prefs: {
      preferredWeekdays: [1],
      unavailableWeekdays: [],
      preLeaveWatering: true,
    },
  },
};

describe("X5 export/import", () => {
  it("round-trips", () => {
    const { data, warnings } = importData(exportData(sample));
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, sample);
  });

  it("keeps unknown fields (app extras) and writes them back", () => {
    const text = JSON.stringify({
      ...JSON.parse(exportData(sample)),
      theme: "forest",
      xp: 120,
    });
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, { ...sample, theme: "forest", xp: 120 });
  });

  it("skips broken plants and says why", () => {
    const text = JSON.stringify({
      format: "green-garden-export",
      version: 1,
      plants: [
        { id: "a", style: "nope", intervalDays: 3 },
        { id: "b", style: "let_top_dry", intervalDays: 0 },
        { id: "c", style: "let_top_dry", intervalDays: 7, lastWatered: "2026-02-31" },
        { id: "c", style: "let_top_dry", intervalDays: 7 },
        42,
      ],
    });
    const { data, warnings } = importData(text);
    assert.deepEqual(
      data.plants.map((p) => p.id),
      ["c"],
    );
    assert.equal(data.plants[0]?.lastWatered, undefined);
    assert.equal(warnings.length, 5);
  });

  it("never throws on junk", () => {
    assert.equal(importData("{nope").data.plants.length, 0);
    assert.equal(importData('{"format":"other"}').warnings.length, 1);
    assert.equal(importData("null").warnings.length, 1);
  });

  it("warns about a newer version but still reads", () => {
    const text = JSON.stringify({ format: "green-garden-export", version: VERSION + 1, rooms: [] });
    assert.equal(importData(text).warnings.length, 1);
  });
});

describe("stores", () => {
  it("memory store keeps what was saved", () => {
    const s = new MemoryStore();
    assert.deepEqual(s.load(), emptyData());
    s.save(sample);
    assert.equal(s.load(), sample);
  });

  it("browser store persists through a key-value object", () => {
    const map = new Map<string, string>();
    const kv: KeyValue = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    };
    const a = new BrowserStore(kv, "k");
    assert.deepEqual(a.load(), emptyData());
    a.save(sample);
    assert.deepEqual(new BrowserStore(kv, "k").load(), sample);
    map.set("k", "garbage");
    assert.deepEqual(new BrowserStore(kv, "k").load(), emptyData());
  });
});

describe("pre-leave watering default", () => {
  it("is on for new data and for imports that do not mention it", () => {
    assert.equal(emptyData().settings.prefs.preLeaveWatering, true);
    const text = JSON.stringify({ ...JSON.parse(exportData(sample)), prefs: {} });
    assert.equal(importData(text).data.settings.prefs.preLeaveWatering, true);
  });

  it("keeps an explicit off through export and import", () => {
    const off = {
      ...sample,
      settings: {
        ...sample.settings,
        prefs: { ...sample.settings.prefs, preLeaveWatering: false },
      },
    };
    assert.equal(importData(exportData(off)).data.settings.prefs.preLeaveWatering, false);
  });
});

describe("plant drafts", () => {
  const draft = {
    id: "d1",
    spaceId: DEFAULT_SPACE_ID,
    savedOn: "2026-10-28",
    fields: { species: "Monstera deliciosa", plantName: "Monty", intervalDays: "7" },
  };

  it("a draft survives export, import and the browser store", () => {
    const data: AppData = { ...sample, drafts: [draft] };
    assert.deepEqual(importData(exportData(data)).data.drafts, [draft]);
    const kv = new Map<string, string>();
    const store = new BrowserStore({
      getItem: (k) => kv.get(k) ?? null,
      setItem: (k, v) => void kv.set(k, v),
    });
    store.save(data);
    assert.deepEqual(store.load().drafts, [draft]);
  });

  it("data without drafts has no drafts key, so older files and tests compare equal", () => {
    assert.equal("drafts" in importData(exportData(sample)).data, false);
    assert.equal("drafts" in emptyData(), false);
  });

  it("a malformed draft is dropped with a warning and the rest still loads", () => {
    const text = JSON.stringify({
      ...JSON.parse(exportData(sample)),
      drafts: [
        draft,
        { id: "d2" },
        { fields: { a: "b" } },
        { id: "d3", savedOn: "x", fields: { a: 3 } },
      ],
    });
    const res = importData(text);
    assert.deepEqual(res.data.drafts, [draft]);
    assert.equal(res.warnings.filter((w) => w.includes("draft")).length, 3);
  });

  it("drafts are not plants", () => {
    assert.equal(importData(exportData({ ...sample, drafts: [draft] })).data.plants.length, 1);
  });
});

describe("language settings and import issue codes", () => {
  const withLang: AppData = {
    ...sample,
    settings: { ...sample.settings, locale: "es", weekStart: 0 },
  };

  it("round-trips locale and weekStart (version 4 export)", () => {
    const text = exportData(withLang);
    assert.equal((JSON.parse(text) as { version: number }).version, 9);
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, withLang);
  });

  it("a version 1 file without them still loads: both stay absent", () => {
    const old = { ...(JSON.parse(exportData(sample)) as object), version: 1 };
    const { data, warnings } = importData(JSON.stringify(old));
    assert.deepEqual(warnings, []);
    assert.equal(data.settings.locale, undefined);
    assert.equal(data.settings.weekStart, undefined);
  });

  it("ignores a bad locale or weekStart instead of failing", () => {
    const bad = JSON.parse(exportData(withLang)) as { settings: Record<string, unknown> };
    bad.settings["locale"] = 5;
    bad.settings["weekStart"] = 9;
    const { data } = importData(JSON.stringify(bad));
    assert.equal(data.settings.locale, undefined);
    assert.equal(data.settings.weekStart, undefined);
  });

  it("reports problems as codes with parameters next to the English text", () => {
    assert.deepEqual(importData("nope").issues, [{ code: "import.notJson", params: {} }]);
    assert.deepEqual(importData('{"format":"other"}').issues, [
      { code: "import.notExport", params: { format: "green-garden-export" } },
    ]);
    const newer = importData(
      JSON.stringify({ format: "green-garden-export", version: 10, rooms: [] }),
    );
    assert.deepEqual(newer.issues, [
      { code: "import.newerVersion", params: { version: "10", supported: 9 } },
    ]);
    assert.equal(newer.issues.length, newer.warnings.length);
  });
});

describe("pinned pre-leave waterings in the export", () => {
  const withPins: AppData = { ...sample, pins: [{ plantId: "p1", date: "2026-11-04" }] };

  it("round-trips pins", () => {
    const text = exportData(withPins);
    assert.equal((JSON.parse(text) as { version: number }).version, 9);
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, withPins);
  });

  it("a file without pins has none; no empty list is written", () => {
    const { data } = importData(exportData(sample));
    assert.equal(data.pins, undefined);
    assert.equal("pins" in (JSON.parse(exportData(sample)) as object), false);
  });

  it("drops a broken pin with a warning and keeps the good ones", () => {
    const raw = JSON.parse(exportData(withPins)) as { pins: unknown[] };
    raw.pins.push({ plantId: "p1", date: "tomorrow" }, { date: "2026-11-05" }, 7);
    const { data, issues } = importData(JSON.stringify(raw));
    assert.deepEqual(data.pins, [{ plantId: "p1", date: "2026-11-04" }]);
    assert.deepEqual(
      issues.map((i) => i.code),
      ["import.badPin", "import.badPin", "import.badPin"],
    );
  });
});

describe("amount, household and room fields", () => {
  const rich: AppData = {
    spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
    plants: [
      {
        id: "p1",
        spaceId: DEFAULT_SPACE_ID,
        name: "Fern",
        style: "keep_moist",
        intervalDays: 4,
        drainage: "no_hole",
        lastRepotted: "2026-03-01",
        growthClass: "fast",
        logs: [],
      },
    ],
    rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID, light: "bright_indirect" }],
    settings: {
      hemisphere: "north",
      horizonDays: 28,
      prefs: {
        preferredWeekdays: [],
        unavailableWeekdays: [],
        preLeaveWatering: true,
      },
      measure: "glass",
      amountMode: "precise",
      wording: "us",
      household: { pets: ["cat", "dog"], children: true },
    },
  };

  it("round-trips them", () => {
    const { data, warnings } = importData(exportData(rich));
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, rich);
  });

  it("ignores values it does not know instead of failing", () => {
    const raw = JSON.parse(exportData(rich)) as {
      plants: Record<string, unknown>[];
      rooms: Record<string, unknown>[];
      settings: Record<string, unknown>;
    };
    raw.plants[0] = {
      ...raw.plants[0],
      drainage: "moat",
      growthClass: "warp",
      lastRepotted: "soon",
    };
    raw.rooms[0] = { ...raw.rooms[0], light: "disco" };
    raw.settings = {
      ...raw.settings,
      measure: "bucket",
      amountMode: "x",
      wording: "au",
      household: { pets: ["cat", "dragon"] },
    };
    const { data } = importData(JSON.stringify(raw));
    assert.equal(data.plants[0]?.drainage, undefined);
    assert.equal(data.plants[0]?.growthClass, undefined);
    assert.equal(data.plants[0]?.lastRepotted, undefined);
    assert.equal(data.rooms[0]?.light, undefined);
    assert.equal(data.settings.measure, undefined);
    assert.equal(data.settings.amountMode, undefined);
    assert.equal(data.settings.wording, undefined);
    assert.deepEqual(data.settings.household, { pets: ["cat"] });
  });

  it("older files without any of them load as before", () => {
    const { data, warnings } = importData(exportData(sample));
    assert.deepEqual(warnings, []);
    assert.equal(data.settings.household, undefined);
  });
});

describe("spaces (D-20)", () => {
  const old = {
    format: "green-garden-export",
    version: 3,
    plants: [
      { id: "p1", name: "Fern", style: "keep_moist", intervalDays: 4, roomId: "r1" },
      { id: "p2", name: "Aloe", style: "let_fully_dry", intervalDays: 14 },
    ],
    rooms: [{ id: "r1", name: "Kitchen" }],
    drafts: [
      {
        id: "d1",
        savedOn: "2026-10-01",
        fields: { plantName: "Draft" },
      },
    ],
    settings: {
      hemisphere: "north",
      horizonDays: 28,
      prefs: { unavailableDates: ["2026-11-03", "2026-11-04"], preLeaveWatering: true },
    },
  };

  it("an old export lands in the default space with its away days", () => {
    const { data, warnings } = importData(JSON.stringify(old));
    assert.deepEqual(warnings, []);
    assert.deepEqual(data.spaces, [
      { id: DEFAULT_SPACE_ID, name: "Home", awayDates: ["2026-11-03", "2026-11-04"] },
    ]);
    assert.deepEqual(
      data.plants.map((p) => p.spaceId),
      [DEFAULT_SPACE_ID, DEFAULT_SPACE_ID],
    );
    assert.equal(data.rooms[0]?.spaceId, DEFAULT_SPACE_ID);
    assert.equal(data.drafts?.[0]?.spaceId, DEFAULT_SPACE_ID);
    assert.equal(data.settings.prefs.unavailableDates, undefined, "away days moved to the space");
  });

  it("the saved local state of an old version loads the same way", () => {
    const kv = new Map<string, string>([["green-garden", JSON.stringify(old)]]);
    const store = new BrowserStore({
      getItem: (k) => kv.get(k) ?? null,
      setItem: (k, v) => void kv.set(k, v),
    });
    const loaded = store.load();
    assert.equal(loaded.spaces.length, 1);
    assert.equal(loaded.plants[0]?.spaceId, DEFAULT_SPACE_ID);
  });

  it("migrating twice changes nothing", () => {
    const once = importData(JSON.stringify(old)).data;
    assert.deepEqual(migrate(once), once);
  });

  it("an empty app has the default space", () => {
    assert.deepEqual(emptyData().spaces, [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }]);
  });

  it("two spaces round-trip in a version 7 export, with their own away days", () => {
    const two: AppData = {
      ...emptyData(),
      settings: sample.settings,
      spaces: [
        { id: "space1", name: "Home", awayDates: ["2026-11-03"] },
        { id: "space2", name: "Office", awayDates: [] },
      ],
      plants: [
        {
          id: "p1",
          name: "Fern",
          style: "keep_moist",
          intervalDays: 4,
          logs: [],
          spaceId: "space1",
        },
        {
          id: "p2",
          name: "Aloe",
          style: "let_fully_dry",
          intervalDays: 14,
          logs: [],
          spaceId: "space2",
        },
      ],
      rooms: [{ id: "r1", name: "Desk", spaceId: "space2" }],
    };
    const text = exportData(two);
    assert.equal((JSON.parse(text) as { version: number }).version, 9);
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, two);
  });

  it("an unknown spaceId moves the item to the default space and says so", () => {
    const raw = JSON.parse(exportData(emptyData())) as Record<string, unknown>;
    raw["plants"] = [
      { id: "p1", name: "Fern", style: "keep_moist", intervalDays: 4, spaceId: "nowhere" },
    ];
    const { data, issues } = importData(JSON.stringify(raw));
    assert.equal(data.plants[0]?.spaceId, DEFAULT_SPACE_ID);
    assert.deepEqual(
      issues.map((i) => i.code),
      ["import.unknownSpace"],
    );
  });

  it("unknown fields on a space are ignored", () => {
    const raw = JSON.parse(exportData(emptyData())) as { spaces: Record<string, unknown>[] };
    raw.spaces[0] = { ...raw.spaces[0], colour: "green" };
    const { data, warnings } = importData(JSON.stringify(raw));
    assert.deepEqual(warnings, []);
    assert.deepEqual(data.spaces, emptyData().spaces);
  });
});

describe("calibration at three levels", () => {
  const cal: AppData = {
    ...sample,
    plants: [
      { ...(sample.plants[0] as AppData["plants"][number]), calibration: { measuredMl: 420 } },
    ],
    rooms: [
      { id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID, calibration: { factor: 1.25 } },
    ],
    settings: { ...sample.settings, calibration: { factor: 0.8 } },
  };

  it("round-trips the plant, room and global calibration (version 7)", () => {
    const text = exportData(cal);
    assert.equal((JSON.parse(text) as { version: number }).version, 9);
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data, cal);
  });

  it("drops a calibration that is not a positive number, keeps the rest", () => {
    const raw = JSON.parse(exportData(cal)) as {
      plants: Record<string, unknown>[];
      rooms: Record<string, unknown>[];
      settings: Record<string, unknown>;
    };
    raw.plants[0] = { ...raw.plants[0], calibration: { measuredMl: -3 } };
    raw.rooms[0] = { ...raw.rooms[0], calibration: { factor: "big" } };
    raw.settings = { ...raw.settings, calibration: { factor: 0 } };
    const { data } = importData(JSON.stringify(raw));
    assert.equal(data.plants[0]?.calibration, undefined);
    assert.equal(data.rooms[0]?.calibration, undefined);
    assert.equal(data.settings.calibration, undefined);
    assert.equal(data.plants.length, 1);
  });

  it("a calibration with both a factor and an amount keeps only the amount", () => {
    const raw = JSON.parse(exportData(cal)) as { plants: Record<string, unknown>[] };
    raw.plants[0] = { ...raw.plants[0], calibration: { factor: 2, measuredMl: 300 } };
    assert.deepEqual(importData(JSON.stringify(raw)).data.plants[0]?.calibration, {
      measuredMl: 300,
    });
  });
});

describe("rooms imported from Home Assistant keep their area id", () => {
  const withArea: AppData = {
    ...sample,
    rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID, haAreaId: "kitchen" }],
  };

  it("round-trips haAreaId (version 7)", () => {
    const text = exportData(withArea);
    assert.equal((JSON.parse(text) as { version: number }).version, 9);
    const { data, warnings } = importData(text);
    assert.deepEqual(warnings, []);
    assert.deepEqual(data.rooms, withArea.rooms);
  });

  it("ignores an area id that is not text", () => {
    const raw = JSON.parse(exportData(withArea)) as { rooms: Record<string, unknown>[] };
    raw.rooms[0] = { ...raw.rooms[0], haAreaId: 7 };
    assert.equal(importData(JSON.stringify(raw)).data.rooms[0]?.haAreaId, undefined);
  });
});
