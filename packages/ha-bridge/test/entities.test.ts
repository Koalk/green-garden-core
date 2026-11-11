// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, type AppData } from "@green-garden/storage";
import { buildSnapshot, slug, type BridgeConfig } from "../src/index.ts";

const TODAY = "2026-11-02";
const cfg: BridgeConfig = { space: "default", discoveryPrefix: "homeassistant" };

function world(extra: Partial<AppData["plants"][number]> = {}): AppData {
  return {
    ...emptyData(),
    plants: [
      // due today (last watered 4 days ago, 4-day interval)
      {
        id: "p1",
        spaceId: "space1",
        name: "Fern",
        style: "keep_moist",
        intervalDays: 4,
        lastWatered: "2026-10-29",
        logs: [],
        ...extra,
      },
      // not due for days
      {
        id: "p2",
        spaceId: "space1",
        name: "Cactus",
        style: "let_fully_dry",
        intervalDays: 21,
        lastWatered: "2026-11-01",
        logs: [],
      },
    ],
  };
}

const find = (msgs: readonly { topic: string; payload: string }[], topic: string) =>
  msgs.find((m) => m.topic === topic);

describe("HA entities for plants", () => {
  it("slug keeps topic and entity ids safe", () => {
    assert.equal(slug("Plant #1/ü"), "plant_1_");
    assert.equal(slug("p1"), "p1");
  });

  it("publishes per plant a binary sensor, a date sensor and two buttons by MQTT discovery", () => {
    const s = buildSnapshot(world(), TODAY, cfg);
    const topics = s.discovery.map((m) => m.topic);
    for (const t of [
      "homeassistant/binary_sensor/gg_default_p1/needs_water/config",
      "homeassistant/sensor/gg_default_p1/next_watering/config",
      "homeassistant/button/gg_default_p1/watered/config",
      "homeassistant/button/gg_default_p1/still_wet/config",
    ]) {
      assert.ok(topics.includes(t), t);
    }
    const bs = JSON.parse(
      find(s.discovery, "homeassistant/binary_sensor/gg_default_p1/needs_water/config")?.payload ??
        "{}",
    ) as Record<string, unknown>;
    assert.equal(bs["name"], "Fern needs water");
    assert.equal(bs["unique_id"], "gg_default_p1_needs_water");
    assert.equal(bs["state_topic"], "green-garden/default/p1/needs_water");
    assert.equal(bs["availability_topic"], "green-garden/default/status");
    const btn = JSON.parse(
      find(s.discovery, "homeassistant/button/gg_default_p1/watered/config")?.payload ?? "{}",
    ) as Record<string, unknown>;
    assert.equal(btn["command_topic"], "green-garden/default/p1/watered/press");
    assert.equal((btn["device"] as Record<string, unknown>)["name"], "Fern");
  });

  it("states: due plants are ON, others OFF; next watering is a date", () => {
    const s = buildSnapshot(world(), TODAY, cfg);
    assert.equal(find(s.states, "green-garden/default/p1/needs_water")?.payload, "ON");
    assert.equal(find(s.states, "green-garden/default/p2/needs_water")?.payload, "OFF");
    assert.equal(find(s.states, "green-garden/default/p1/next_watering")?.payload, TODAY);
    assert.match(find(s.states, "green-garden/default/p2/next_watering")?.payload ?? "", /^2026-/);
  });

  it("a plant watered today is no longer due and its next date moves on", () => {
    const s = buildSnapshot(
      world({ logs: [{ date: TODAY, outcome: "done" }], lastWatered: TODAY }),
      TODAY,
      cfg,
    );
    assert.equal(find(s.states, "green-garden/default/p1/needs_water")?.payload, "OFF");
    assert.ok((find(s.states, "green-garden/default/p1/next_watering")?.payload ?? "") > TODAY);
  });

  it("still wet closes the plant for today; dry early does not", () => {
    const wet = buildSnapshot(world({ logs: [{ date: TODAY, outcome: "still_wet" }] }), TODAY, cfg);
    assert.equal(find(wet.states, "green-garden/default/p1/needs_water")?.payload, "OFF");
    const dry = buildSnapshot(world({ logs: [{ date: TODAY, outcome: "dry_early" }] }), TODAY, cfg);
    assert.equal(find(dry.states, "green-garden/default/p1/needs_water")?.payload, "ON");
  });

  it("summary entities: due count and a text list", () => {
    const s = buildSnapshot(world(), TODAY, cfg);
    assert.equal(find(s.states, "green-garden/default/due_count")?.payload, "1");
    assert.equal(find(s.states, "green-garden/default/due_list")?.payload, "Fern");
    assert.ok(
      s.discovery.some((m) => m.topic === "homeassistant/sensor/gg_default/due_count/config"),
    );
    assert.ok(
      s.discovery.some((m) => m.topic === "homeassistant/sensor/gg_default/due_list/config"),
    );
    const none = buildSnapshot(emptyData(), TODAY, cfg);
    assert.equal(find(none.states, "green-garden/default/due_list")?.payload, "Nothing");
  });

  it("maps button topics to a plant and an action", () => {
    const s = buildSnapshot(world(), TODAY, cfg);
    assert.deepEqual(s.commands.get("green-garden/default/p1/watered/press"), {
      plantId: "p1",
      action: "watered",
    });
    assert.deepEqual(s.commands.get("green-garden/default/p2/still_wet/press"), {
      plantId: "p2",
      action: "still_wet",
    });
  });

  it("everything is retained so HA keeps it across a restart", () => {
    const s = buildSnapshot(world(), TODAY, cfg);
    assert.ok([...s.discovery, ...s.states].every((m) => m.retain));
  });

  it("only the configured space is published", () => {
    const d = world();
    const two: AppData = {
      ...d,
      spaces: [...d.spaces, { id: "office", name: "Office", awayDates: [] }],
      plants: [
        ...d.plants,
        {
          id: "p9",
          spaceId: "office",
          name: "Ivy",
          style: "keep_moist",
          intervalDays: 3,
          logs: [],
        },
      ],
    };
    const s = buildSnapshot(two, TODAY, cfg);
    assert.ok(!s.states.some((m) => m.topic.includes("/p9/")));
    const office = buildSnapshot(two, TODAY, { ...cfg, space: "default", spaceId: "office" });
    assert.ok(office.states.some((m) => m.topic.includes("/p9/")));
  });
});
