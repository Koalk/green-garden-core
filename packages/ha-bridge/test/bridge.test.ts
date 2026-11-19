// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Backend, LoadResult, SaveResult } from "@green-garden/client";
import { emptyData, type AppData } from "@green-garden/storage";
import { Bridge, type HaTransport, type Msg } from "../src/index.ts";

const NOW = new Date(2026, 10, 2, 9, 0);
const TODAY = "2026-11-02";

const world = (): AppData => ({
  ...emptyData(),
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-10-29",
      logs: [],
    },
  ],
});

class FakeBackend implements Backend {
  data = world();
  revision = 3;
  saves: AppData[] = [];
  /** Saves to answer "conflict" for, as if a second device saved in between. */
  conflicts = 0;
  failLoad: "unreachable" | undefined;
  load(): Promise<LoadResult> {
    if (this.failLoad !== undefined) return Promise.resolve({ ok: false, reason: this.failLoad });
    return Promise.resolve({ ok: true, data: this.data, revision: this.revision });
  }
  save(data: AppData, base: number): Promise<SaveResult> {
    if (this.conflicts > 0 || base !== this.revision) {
      this.conflicts = Math.max(0, this.conflicts - 1);
      this.revision += 1;
      return Promise.resolve({ ok: false, reason: "conflict", revision: this.revision });
    }
    this.data = data;
    this.revision += 1;
    this.saves.push(data);
    return Promise.resolve({ ok: true, revision: this.revision });
  }
}

class FakeTransport implements HaTransport {
  published: Msg[] = [];
  subscribed: string[] = [];
  handler: ((topic: string, payload: string) => void) | undefined;
  publish(m: Msg): Promise<void> {
    this.published.push(m);
    return Promise.resolve();
  }
  subscribe(topics: readonly string[], h: (topic: string, payload: string) => void): Promise<void> {
    this.subscribed.push(...topics);
    this.handler = h;
    return Promise.resolve();
  }
  last(topic: string): string | undefined {
    return this.published.findLast((m) => m.topic === topic)?.payload;
  }
}

let backend: FakeBackend;
let transport: FakeTransport;
let bridge: Bridge;
beforeEach(() => {
  backend = new FakeBackend();
  transport = new FakeTransport();
  bridge = new Bridge({
    backend,
    transport,
    config: { space: "default", discoveryPrefix: "homeassistant" },
    now: () => NOW,
  });
});

const WATERED = "green-garden/default/p1/watered/press";

describe("HA bridge", () => {
  it("sync publishes discovery and states, then marks itself online", async () => {
    await bridge.sync();
    assert.notEqual(transport.last("homeassistant/button/gg_default_p1/watered/config"), undefined);
    assert.equal(transport.last("green-garden/default/p1/needs_water"), "ON");
    assert.equal(transport.last("green-garden/default/status"), "online");
  });

  it("start subscribes to the button topics", async () => {
    await bridge.start();
    assert.deepEqual(transport.subscribed.sort(), [
      "green-garden/default/p1/still_wet/press",
      WATERED,
    ]);
  });

  it("pressing watered logs done in the server and republishes", async () => {
    await bridge.start();
    assert.deepEqual(await bridge.press(WATERED, "PRESS"), { ok: true });
    assert.deepEqual(backend.data.plants[0]?.logs, [{ date: TODAY, outcome: "done" }]);
    assert.equal(transport.last("green-garden/default/p1/needs_water"), "OFF");
    assert.equal(transport.last("green-garden/default/due_count"), "0");
  });

  it("pressing still wet logs still_wet", async () => {
    await bridge.start();
    await bridge.press("green-garden/default/p1/still_wet/press", "PRESS");
    assert.deepEqual(backend.data.plants[0]?.logs, [{ date: TODAY, outcome: "still_wet" }]);
  });

  it("ignores payloads other than PRESS and unknown topics", async () => {
    await bridge.start();
    assert.deepEqual(await bridge.press(WATERED, "x"), { ok: false, reason: "ignored" });
    assert.deepEqual(await bridge.press("green-garden/default/nope/watered/press", "PRESS"), {
      ok: false,
      reason: "ignored",
    });
    assert.equal(backend.saves.length, 0);
  });

  it("a conflict retries once with fresh data and then succeeds", async () => {
    await bridge.start();
    backend.conflicts = 1;
    assert.deepEqual(await bridge.press(WATERED, "PRESS"), { ok: true });
    assert.equal(backend.saves.length, 1);
  });

  it("two conflicts in a row are reported, not looped on", async () => {
    await bridge.start();
    backend.conflicts = 2;
    assert.deepEqual(await bridge.press(WATERED, "PRESS"), { ok: false, reason: "conflict" });
    assert.equal(backend.saves.length, 0);
  });

  it("an unreachable server is reported and nothing new is published", async () => {
    await bridge.start();
    const before = transport.published.length;
    backend.failLoad = "unreachable";
    assert.deepEqual(await bridge.press(WATERED, "PRESS"), { ok: false, reason: "unreachable" });
    assert.equal(transport.published.length, before);
  });

  it("a plant removed on the server is removed from HA on the next sync", async () => {
    await bridge.sync();
    backend.data = emptyData();
    backend.revision += 1;
    await bridge.sync();
    assert.equal(transport.last("homeassistant/button/gg_default_p1/watered/config"), "");
    assert.equal(
      transport.last("homeassistant/binary_sensor/gg_default_p1/needs_water/config"),
      "",
    );
  });

  it("stop marks the bridge offline", async () => {
    await bridge.start();
    await bridge.stop();
    assert.equal(transport.last("green-garden/default/status"), "offline");
  });

  it("the transport's message handler routes presses", async () => {
    await bridge.start();
    transport.handler?.(WATERED, "PRESS");
    await bridge.idle();
    assert.equal(backend.saves.length, 1);
  });
});
