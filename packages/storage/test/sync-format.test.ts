// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOUSEHOLD_SETTINGS_KEYS,
  PERSONAL_SETTINGS_KEYS,
  VERSION,
  ZERO_STAMP,
  derivedId,
  exportData,
  importData,
  makePlan,
  migrate,
} from "../src/index.ts";

type Loose = Record<string, unknown>;

/** A format 10 file as the last build wrote it: no stamps, no log IDs, no `sync`. */
function v10File(): string {
  return JSON.stringify({
    format: "green-garden-export",
    version: 10,
    spaces: [{ id: "space1", name: "Home", awayDates: ["2026-12-24", "2026-12-25"] }],
    plants: [
      {
        id: "p1",
        name: "Fern",
        style: "keep_moist",
        intervalDays: 4,
        roomId: "r1",
        spaceId: "space1",
        lastWatered: "2026-11-10",
        logs: [
          { date: "2026-11-01", outcome: "done" },
          { date: "2026-11-05", outcome: "skipped" },
          { date: "2026-11-10", outcome: "done" },
        ],
      },
      {
        id: "p2",
        name: "Cactus",
        style: "let_fully_dry",
        intervalDays: 21,
        spaceId: "space1",
        logs: [{ date: "2026-11-02", outcome: "rain", mm: 4 }],
      },
      { id: "p3", name: "Pothos", style: "let_top_dry", intervalDays: 7, spaceId: "space1" },
    ],
    rooms: [{ id: "r1", name: "Kitchen", spaceId: "space1", light: "bright_indirect" }],
    settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
    stories: { xp: 5 },
  });
}

const parsed = (text: string): Loose => JSON.parse(text) as Loose;
const plantsOf = (text: string): Loose[] => parsed(text)["plants"] as Loose[];
/** The first plant of a parsed file, for tests that edit it. */
function firstPlant(file: Loose): Loose {
  return (file["plants"] as Loose[])[0] ?? {};
}
const logsOf = (p: Loose | undefined): Loose[] => (p?.["logs"] ?? []) as Loose[];

/** The same data without the format 11 additions, to compare what is left. */
function stripNew(data: unknown): unknown {
  const walk = (v: unknown, inLogs: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inLogs));
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => {
            if (["stamps", "sync", "awayStamps", "awayTombstones"].includes(k)) return false;
            return !(inLogs && ["id", "by", "at"].includes(k));
          })
          .map(([k, x]) => [k, walk(x, k === "logs")]),
      );
    }
    return v;
  };
  return walk(data, false);
}

describe("format 11", () => {
  it("says version 11", () => {
    assert.equal(VERSION, 11);
    assert.equal(parsed(exportData(importData(v10File()).data))["version"], 11);
  });

  it("migrates a version 10 file: stamp 0 on every existing field, derived log IDs, no `by`", () => {
    const out = importData(v10File());
    assert.deepEqual(out.warnings, []);
    const exp = exportData(out.data);
    const p1 = plantsOf(exp).find((p) => p["id"] === "p1");
    const stamps = p1?.["stamps"] as Loose;
    for (const field of ["name", "style", "intervalDays", "roomId", "lastWatered", "spaceId"]) {
      assert.equal(stamps[field], ZERO_STAMP, field);
    }
    const logs = logsOf(p1);
    assert.equal(logs.length, 3);
    logs.forEach((l, i) => {
      const date = l["date"] as string;
      const outcome = l["outcome"] as string;
      assert.equal(l["id"], derivedId("p1", date, outcome, i));
      assert.equal(l["at"], ZERO_STAMP);
      assert.equal("by" in l, false);
    });
    const room = (parsed(exp)["rooms"] as Loose[])[0];
    assert.equal((room?.["stamps"] as Loose)["light"], ZERO_STAMP);
    const space = (parsed(exp)["spaces"] as Loose[])[0];
    assert.deepEqual(space?.["awayStamps"], {
      "2026-12-24": ZERO_STAMP,
      "2026-12-25": ZERO_STAMP,
    });
  });

  it("mints a device ID on first load and keeps the same one after", () => {
    const first = importData(v10File()).data;
    const dev = first.sync?.device;
    assert.match(dev ?? "", /^[0-9a-f]{16}$/);
    assert.equal(first.sync?.stamp, ZERO_STAMP);
    const again = importData(exportData(first)).data;
    assert.equal(again.sync?.device, dev);
  });

  it("gives the same log IDs to the same version 10 file migrated on two devices", () => {
    const a = plantsOf(exportData(importData(v10File()).data));
    const b = plantsOf(exportData(importData(v10File()).data));
    assert.deepEqual(
      a.map((p) => logsOf(p).map((l) => l["id"])),
      b.map((p) => logsOf(p).map((l) => l["id"])),
    );
    assert.notEqual(
      importData(v10File()).data.sync?.device,
      importData(v10File()).data.sync?.device,
    );
  });

  it("derives different IDs for different (plant, date, outcome, position)", () => {
    const ids = [
      derivedId("p1", "2026-11-01", "done", 0),
      derivedId("p1", "2026-11-01", "done", 1),
      derivedId("p1", "2026-11-01", "skipped", 0),
      derivedId("p1", "2026-11-02", "done", 0),
      derivedId("p2", "2026-11-01", "done", 0),
    ];
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps every other value of a version 10 file as it was", () => {
    // The same file read as version 11 runs no migration step: that is what "as it was" exports as.
    const asIs = parsed(
      exportData(importData(v10File().replace('"version":10', '"version":11')).data),
    );
    const migrated = parsed(exportData(importData(v10File()).data));
    assert.deepEqual(stripNew(migrated), stripNew(asIs));
  });

  it("plans a migrated version 10 file exactly as before", () => {
    const migrated = importData(v10File()).data;
    const before = migrate(stripNew(migrated) as Parameters<typeof migrate>[0], VERSION);
    for (const today of ["2026-11-11", "2026-12-01"]) {
      assert.deepEqual(makePlan(migrated, today), makePlan(before, today));
    }
  });

  it("round-trips a version 11 file with every new field", () => {
    const s = "000000001000-0001-aaaaaaaaaaaaaaaa";
    const file = {
      format: "green-garden-export",
      version: 11,
      sync: {
        device: "aaaaaaaaaaaaaaaa",
        stamp: s,
        household: { id: "1111111111111111", key: "a2V5" },
        members: [
          { index: 0, name: "Ana", personal: { locale: "es" } },
          { index: 1, name: "Pat", personal: {} },
        ],
        me: 0,
        seen: { "0": s, "1": "000000000900-0000-bbbbbbbbbbbbbbbb" },
        tombstones: { "away:space1:2026-12-01": s },
      },
      spaces: [
        {
          id: "space1",
          name: "Home",
          awayDates: ["2026-12-24"],
          awayStamps: { "2026-12-24": s },
          awayTombstones: { "2026-12-01": s },
        },
      ],
      plants: [
        {
          id: "p1",
          name: "Fern",
          style: "keep_moist",
          intervalDays: 4,
          spaceId: "space1",
          stamps: { name: s, intervalDays: ZERO_STAMP },
          checkpoint: { cutoff: "2026-09-20", seed: { lastWatered: "2026-09-18", doneStreak: 2 } },
          logs: [{ date: "2026-11-01", outcome: "done", id: "22222222aaaaaaaa", by: 1, at: s }],
        },
        {
          id: "p2",
          name: "Gone",
          style: "keep_moist",
          intervalDays: 4,
          spaceId: "space1",
          deleted: true,
          logs: [],
          stamps: { deleted: s },
        },
      ],
      rooms: [{ id: "r1", name: "Kitchen", spaceId: "space1", stamps: { name: s }, deleted: true }],
      settings: {
        hemisphere: "north",
        horizonDays: 28,
        prefs: { preLeaveWatering: true, preferredWeekdays: [], unavailableWeekdays: [] },
      },
    };
    const out = importData(JSON.stringify(file));
    assert.deepEqual(out.warnings, []);
    assert.deepEqual(parsed(exportData(out.data)), file);
  });

  it("drops junk in the new fields with a warning instead of keeping it", () => {
    const file = parsed(v10File());
    file["version"] = 11;
    firstPlant(file)["logs"] = [
      { date: "2026-11-01", outcome: "done", id: 5, by: "x", at: "not-a-stamp" },
    ];
    firstPlant(file)["stamps"] = { name: "garbage", style: ZERO_STAMP };
    const out = importData(JSON.stringify(file));
    const p = plantsOf(exportData(out.data))[0];
    const log = logsOf(p)[0];
    assert.equal(log?.["id"], derivedId("p1", "2026-11-01", "done", 0));
    assert.equal("by" in { ...log }, false);
    assert.equal((p?.["stamps"] as Loose)["name"], undefined);
    assert.equal((p?.["stamps"] as Loose)["style"], ZERO_STAMP);
    assert.ok(out.warnings.length > 0);
  });

  it("keeps unknown keys from a newer file and still reads the new fields", () => {
    const file = parsed(v10File());
    file["version"] = 12;
    file["future"] = { a: 1 };
    firstPlant(file)["futureField"] = "x";
    firstPlant(file)["logs"] = [
      {
        date: "2026-11-01",
        outcome: "done",
        id: "0123456789abcdef",
        by: 2,
        at: ZERO_STAMP,
        extra: 1,
      },
    ];
    const back = parsed(exportData(importData(JSON.stringify(file)).data));
    assert.deepEqual(back["future"], { a: 1 });
    const p = (back["plants"] as Loose[])[0];
    assert.equal(p?.["futureField"], "x");
    assert.deepEqual(logsOf(p)[0], {
      date: "2026-11-01",
      outcome: "done",
      id: "0123456789abcdef",
      by: 2,
      at: ZERO_STAMP,
      extra: 1,
    });
    assert.deepEqual(back["stories"], { xp: 5 });
  });

  it("migrating twice changes nothing", () => {
    const once = importData(v10File()).data;
    const twice = importData(exportData(once)).data;
    assert.deepEqual(twice, once);
  });
});

describe("household and personal keys", () => {
  it("are two disjoint fixed lists covering the settings keys", () => {
    const h = new Set<string>(HOUSEHOLD_SETTINGS_KEYS);
    assert.deepEqual(
      PERSONAL_SETTINGS_KEYS.filter((k) => h.has(k)),
      [],
    );
    for (const k of [
      "hemisphere",
      "latitude",
      "country",
      "climate",
      "winterMin",
      "household",
      "weather",
      "calibration",
    ])
      assert.ok(h.has(k), k);
    for (const k of [
      "locale",
      "measure",
      "amountMode",
      "wording",
      "weekStart",
      "horizonDays",
      "reminders",
      "questions",
    ])
      assert.ok((PERSONAL_SETTINGS_KEYS as readonly string[]).includes(k), k);
  });
});
