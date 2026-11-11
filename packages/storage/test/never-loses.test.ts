// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BrowserStore,
  VERSION,
  buildPlanInput,
  exportData,
  importData,
  invalidPlants,
  type KeyValue,
} from "../src/index.ts";

type Loose = Record<string, unknown>;

/** Reads a nested value of parsed JSON by key path. */
function at(v: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc as Record<string | number, unknown>)[k], v);
}

/** The A-1 probe (audit correction 3): a same-version file with data this build does not know. */
function probeFile(version: number = VERSION): string {
  return JSON.stringify({
    format: "green-garden-export",
    version,
    futureTop: { a: [1, 2] },
    stories: { xp: 120, streak: 3 },
    plants: [
      {
        id: "p1",
        name: "Fern",
        style: "keep_moist",
        intervalDays: 4,
        sunHours: 3,
        logs: [{ date: "2026-10-30", outcome: "done", note: "a bit limp" }],
      },
      { id: "p2", name: "Odd", style: "mist_weekly", intervalDays: 5, logs: [], hue: "red" },
    ],
    rooms: [{ id: "r1", name: "Kitchen", tint: "blue" }],
    settings: { hemisphere: "north", horizonDays: 14, futureSetting: { on: true } },
  });
}

function memory(initial?: string): KeyValue & { items: Map<string, string> } {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set("green-garden", initial);
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      items.set(k, v);
    },
  };
}

describe("import keeps what it does not understand", () => {
  const out = JSON.parse(exportData(importData(probeFile()).data)) as Loose;

  it("unknown plant, log, room, settings and top-level keys come back out", () => {
    assert.equal(at(out, "plants", 0, "sunHours"), 3);
    assert.equal(at(out, "plants", 0, "logs", 0, "note"), "a bit limp");
    assert.equal(at(out, "rooms", 0, "tint"), "blue");
    assert.deepEqual(at(out, "settings", "futureSetting"), { on: true });
    assert.deepEqual(out["futureTop"], { a: [1, 2] });
  });

  it("the stories section survives a core round trip", () => {
    assert.deepEqual(out["stories"], { xp: 120, streak: 3 });
  });

  it("known fields stay validated", () => {
    const text = JSON.stringify({
      ...JSON.parse(probeFile()),
      settings: { hemisphere: "sideways", horizonDays: 14 },
    });
    assert.equal(importData(text).data.settings.hemisphere, "north");
  });

  it("a file import still refuses a plant it cannot read, with the warning", () => {
    const res = importData(probeFile());
    assert.equal(res.data.plants.length, 1);
    assert.ok(res.issues.some((i) => i.code === "import.plantIncomplete"));
  });
});

describe("a store load never drops a plant", () => {
  it("keeps the unknown watering style plant, marked, with its own keys", () => {
    const res = importData(probeFile(), { keepInvalid: true });
    assert.equal(res.data.plants.length, 2);
    const odd = res.data.plants.find((p) => p.id === "p2");
    assert.deepEqual(odd?.invalid, ["import.plantIncomplete"]);
    assert.equal((odd as unknown as Loose)["style"], "mist_weekly");
    assert.deepEqual(
      invalidPlants(res.data).map((p) => p.id),
      ["p2"],
    );
  });

  it("round trips the marked plant through export", () => {
    const first = importData(probeFile(), { keepInvalid: true }).data;
    const again = importData(exportData(first), { keepInvalid: true }).data;
    assert.equal(again.plants.length, 2);
    assert.equal((again.plants[1] as unknown as Loose)["hue"], "red");
  });

  it("the plan ignores a marked plant instead of crashing on it", () => {
    const data = importData(probeFile(), { keepInvalid: true }).data;
    const input = buildPlanInput(data, "2026-11-01");
    assert.deepEqual(
      (input.plants ?? []).map((p) => p.id),
      ["p1"],
    );
  });

  it("a plant that is readable again loses its mark", () => {
    const text = JSON.stringify({
      ...JSON.parse(probeFile()),
      plants: [
        { id: "p2", name: "Odd", style: "keep_moist", intervalDays: 5, logs: [], invalid: ["x"] },
      ],
    });
    const p = importData(text, { keepInvalid: true }).data.plants[0];
    assert.equal(p?.invalid, undefined);
  });

  it("BrowserStore load then save keeps both plants and the stories section", () => {
    const kv = memory(probeFile());
    const store = new BrowserStore(kv);
    store.save(store.load());
    const saved = JSON.parse(kv.items.get("green-garden") ?? "{}") as Loose;
    assert.equal((saved["plants"] as unknown[]).length, 2);
    assert.deepEqual(saved["stories"], { xp: 120, streak: 3 });
  });
});

describe("loading a store is not importing a file", () => {
  const now = () => new Date("2026-11-10T09:30:15Z");
  const backup = "green-garden.backup-20261110T093015Z";

  it("damaged text is copied to a backup key before anything is saved", () => {
    const kv = memory("{not json");
    const store = new BrowserStore(kv, "green-garden", now);
    const data = store.load();
    assert.equal(data.plants.length, 0);
    const report = store.lastLoad;
    assert.ok(report?.issues.some((i) => i.code === "import.notJson"));
    assert.equal(report?.backupKey, backup);
    assert.equal(kv.items.get(backup), "{not json");
    store.save(data);
    assert.equal(kv.items.get(backup), "{not json");
  });

  it("a higher version is read, backed up, and not overwritten without confirmation", () => {
    const text = probeFile(VERSION + 1);
    const kv = memory(text);
    const store = new BrowserStore(kv, "green-garden", now);
    const data = store.load();
    assert.equal(data.plants.length, 2);
    assert.equal(store.lastLoad?.newerVersion, VERSION + 1);
    assert.equal(kv.items.get(backup), text);
    assert.throws(() => {
      store.save(data);
    }, /newer/);
    assert.equal(kv.items.get("green-garden"), text);
    store.confirmOverwrite();
    store.save(data);
    assert.notEqual(kv.items.get("green-garden"), text);
  });

  it("good text makes no backup", () => {
    const kv = memory(probeFile());
    const store = new BrowserStore(kv, "green-garden", now);
    store.load();
    assert.equal(store.lastLoad?.backupKey, undefined);
    assert.equal(kv.items.size, 1);
  });

  it("a failed save is reported, not swallowed", () => {
    const kv = memory(probeFile());
    kv.setItem = () => {
      throw new Error("quota");
    };
    const store = new BrowserStore(kv);
    assert.throws(() => {
      store.save(store.load());
    }, /quota/);
  });
});

describe("format version 9", () => {
  const file = (version: number, plant: Loose): string =>
    JSON.stringify({
      format: "green-garden-export",
      version,
      plants: [
        { id: "p1", name: "Fern", style: "keep_moist", intervalDays: 4, logs: [], ...plant },
      ],
      rooms: [],
      settings: {},
    });

  it("is 9, and a version 8 file with addedOn, history and sun hours reads and writes as 9", () => {
    assert.equal(VERSION, 9);
    const v8 = file(8, {
      addedOn: "2026-09-01",
      directSun: [{ from: 9, to: 12 }],
      placementHistory: [{ on: "2026-09-01", placement: "indoor" }],
    });
    const back = JSON.parse(exportData(importData(v8).data)) as Loose;
    assert.equal(back["version"], 9);
    assert.equal(at(back, "plants", 0, "addedOn"), "2026-09-01");
    assert.deepEqual(at(back, "plants", 0, "directSun"), [{ from: 9, to: 12 }]);
    assert.equal((at(back, "plants", 0, "placementHistory") as unknown[]).length, 1);
  });

  it("a version 8 plant without addedOn gets an estimate from its history; version 9 does not", () => {
    const logs = [{ date: "2026-10-01", outcome: "done" }];
    assert.equal(importData(file(8, { logs })).data.plants[0]?.addedOn, "2026-10-01");
    assert.equal(importData(file(9, { logs })).data.plants[0]?.addedOn, undefined);
  });
});
