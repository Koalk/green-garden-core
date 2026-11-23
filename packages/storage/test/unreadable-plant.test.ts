// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VERSION,
  exportData,
  importData,
  invalidPlants,
  plantProblem,
  plantText,
  repairPlant,
} from "../src/index.ts";

const file = (plants: unknown[], version: number = VERSION): string =>
  JSON.stringify({ format: "green-garden-export", version, plants, rooms: [] });

const firstInvalid = (data: ReturnType<typeof loadKept>) => {
  const p = invalidPlants(data)[0];
  assert.ok(p);
  return p;
};
const loadKept = (plants: unknown[]) => importData(file(plants), { keepInvalid: true }).data;

describe("why a plant could not be read", () => {
  it("names the field and the bad value for an unknown style", () => {
    const data = loadKept([{ id: "m", name: "Mist", style: "mist", intervalDays: 4, logs: [] }]);
    const [p] = invalidPlants(data);
    assert.ok(p);
    assert.deepEqual(plantProblem(p), { kind: "badValue", field: "style", value: "mist" });
  });
  it("names a missing interval and a bad one", () => {
    const [a, b] = invalidPlants(
      loadKept([
        { id: "a", style: "keep_moist", logs: [] },
        { id: "b", style: "keep_moist", intervalDays: 0, logs: [] },
      ]),
    );
    assert.ok(a && b);
    assert.deepEqual(plantProblem(a), { kind: "badValue", field: "intervalDays" });
    assert.deepEqual(plantProblem(b), { kind: "badValue", field: "intervalDays", value: "0" });
  });
  it("says a plant without an id has none, and a non-object plant is not an object", () => {
    const [a, b] = invalidPlants(loadKept([{ style: "keep_moist", intervalDays: 3 }, "seven"]));
    assert.ok(a && b);
    assert.deepEqual(plantProblem(a), { kind: "badValue", field: "id" });
    assert.deepEqual(plantProblem(b), { kind: "notObject" });
  });
  it("says a duplicate id is a duplicate", () => {
    const ok = { id: "x", style: "keep_moist", intervalDays: 3, logs: [] };
    const [d] = invalidPlants(loadKept([ok, ok]));
    assert.ok(d);
    assert.deepEqual(plantProblem(d), { kind: "duplicateId", value: "x" });
  });
});

describe("a kept plant's data and the check-and-save fix", () => {
  const bad = { id: "m", name: "Mist", style: "mist", intervalDays: 4, logs: [], hue: "red" };

  it("shows the plant's JSON without the unreadable mark", () => {
    const [p] = invalidPlants(loadKept([bad]));
    assert.ok(p);
    const o = JSON.parse(plantText(p)) as Record<string, unknown>;
    assert.equal(o["style"], "mist");
    assert.equal(o["hue"], "red");
    assert.equal("invalid" in o, false);
  });

  it("an edit that reads replaces the kept copy and the plant is normal again", () => {
    const data = loadKept([bad]);
    const fixed = plantText(firstInvalid(data)).replace('"mist"', '"let_top_dry"');
    const res = repairPlant(data, "m", fixed);
    assert.ok(res.ok);
    assert.equal(invalidPlants(res.data).length, 0);
    const p = res.data.plants.find((x) => x.id === "m");
    assert.equal(p?.style, "let_top_dry");
    assert.equal((p as unknown as Record<string, unknown>)["hue"], "red");
    // it exports and loads back as a normal plant
    assert.equal(
      invalidPlants(importData(exportData(res.data), { keepInvalid: true }).data).length,
      0,
    );
  });

  it("an edit that still does not read gives the new reason and changes nothing", () => {
    const data = loadKept([bad]);
    const res = repairPlant(data, "m", plantText(firstInvalid(data)).replace('"mist"', '"spray"'));
    assert.ok(!res.ok);
    assert.deepEqual(res.problem, { kind: "badValue", field: "style", value: "spray" });
    assert.equal(data.plants.find((x) => x.id === "m")?.invalid !== undefined, true);
  });

  it("text that is not JSON, and an id that clashes with another plant, are refused", () => {
    const ok = { id: "k", style: "keep_moist", intervalDays: 3, logs: [] };
    const data = loadKept([bad, ok]);
    const r1 = repairPlant(data, "m", "{ nope");
    assert.deepEqual(r1.ok ? undefined : r1.problem, { kind: "notJson" });
    const r2 = repairPlant(data, "m", JSON.stringify({ ...bad, style: "keep_moist", id: "k" }));
    assert.deepEqual(r2.ok ? undefined : r2.problem, { kind: "duplicateId", value: "k" });
  });
});
