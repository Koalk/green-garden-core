// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale, t } from "@green-garden/i18n";
import type { Backend, LoadResult, SaveResult } from "@green-garden/client";
import { emptyData, type AppData } from "@green-garden/storage";
import {
  SYNC_KEY,
  SyncSession,
  loadSyncConfig,
  saveSyncConfig,
  syncHtml,
  syncMessageKey,
} from "../src/index.ts";

afterEach(() => {
  setLocale("en-GB");
});

const plant = {
  id: "p1",
  spaceId: "space1",
  name: "Fern",
  style: "keep_moist" as const,
  intervalDays: 4,
  logs: [],
};
const withFern: AppData = { ...emptyData(), plants: [plant] };

/** A scripted backend: the answers come from the test, the calls are recorded. */
function backend(load: LoadResult, save: SaveResult): { b: Backend; saves: number[] } {
  const saves: number[] = [];
  return {
    saves,
    b: {
      load: () => Promise.resolve(load),
      save: (_data, base) => {
        saves.push(base);
        return Promise.resolve(save);
      },
    },
  };
}

function kv(): {
  store: Map<string, string>;
  api: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
} {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    },
  };
}

describe("server connection settings", () => {
  it("round-trips the server address and token, and forgets them again", () => {
    const { api, store } = kv();
    assert.equal(loadSyncConfig(api), undefined);
    saveSyncConfig(api, { url: "http://localhost:8080", token: "tok" });
    assert.deepEqual(loadSyncConfig(api), { url: "http://localhost:8080", token: "tok" });
    saveSyncConfig(api, undefined);
    assert.equal(loadSyncConfig(api), undefined);
    assert.equal(store.size, 0);
  });

  it("ignores a damaged entry", () => {
    const { api } = kv();
    api.setItem(SYNC_KEY, "{nope");
    assert.equal(loadSyncConfig(api), undefined);
    api.setItem(SYNC_KEY, JSON.stringify({ url: "", token: "x" }));
    assert.equal(loadSyncConfig(api), undefined);
  });
});

describe("SyncSession", () => {
  it("uploads local data when the server is empty", async () => {
    const { b, saves } = backend(
      { ok: true, data: emptyData(), revision: 0 },
      { ok: true, revision: 1 },
    );
    const s = new SyncSession(b);
    assert.deepEqual(await s.connect(withFern), { kind: "uploaded" });
    assert.deepEqual(saves, [0]);
    assert.equal(s.revision, 1);
  });

  it("offers the server's data when it already has some", async () => {
    const { b, saves } = backend(
      { ok: true, data: withFern, revision: 5 },
      { ok: true, revision: 6 },
    );
    const s = new SyncSession(b);
    const r = await s.connect(emptyData());
    assert.equal(r.kind, "remote");
    assert.deepEqual(saves, [], "nothing is overwritten on connect");
    assert.equal(s.revision, 5);
  });

  it("pushes with the last known revision and tracks the new one", async () => {
    const { b, saves } = backend(
      { ok: true, data: withFern, revision: 5 },
      { ok: true, revision: 6 },
    );
    const s = new SyncSession(b);
    await s.connect(emptyData());
    assert.equal(await s.push(withFern), "ok");
    assert.equal(await s.push(withFern), "ok");
    assert.deepEqual(saves, [5, 6]);
  });

  it("reports a conflict and keeps the old revision", async () => {
    const { b } = backend(
      { ok: true, data: withFern, revision: 5 },
      { ok: false, reason: "conflict", revision: 7 },
    );
    const s = new SyncSession(b);
    await s.connect(emptyData());
    assert.equal(await s.push(withFern), "conflict");
    assert.equal(s.revision, 5);
  });

  it("pull takes the server's data and revision, the way out of a conflict", async () => {
    const { b } = backend({ ok: true, data: withFern, revision: 7 }, { ok: true, revision: 8 });
    const s = new SyncSession(b);
    const r = await s.pull();
    assert.equal(r.kind, "remote");
    assert.equal(s.revision, 7);
  });

  it("passes failures through", async () => {
    const { b } = backend(
      { ok: false, reason: "unreachable" },
      { ok: false, reason: "unauthorised" },
    );
    const s = new SyncSession(b);
    assert.deepEqual(await s.connect(emptyData()), { kind: "failed", status: "unreachable" });
    assert.equal(await s.push(withFern), "unauthorised");
  });
});

describe("server settings in the UI", () => {
  it("has a worded message for every status, in English", () => {
    for (const s of ["conflict", "unreachable", "unauthorised", "invalid"] as const) {
      const key = syncMessageKey(s);
      assert.ok(key);
      assert.notEqual(t(key), key, `${s} has text`);
    }
    assert.equal(syncMessageKey("ok"), undefined);
  });

  it("shows the form when local and the address (never the token) when connected", () => {
    const local = syncHtml(undefined);
    assert.ok(local.includes('data-form="server"'));
    const remote = syncHtml({ url: "http://localhost:8080", token: "super-secret" });
    assert.ok(remote.includes("http://localhost:8080"));
    assert.ok(!remote.includes("super-secret"));
    assert.ok(remote.includes('data-action="server-pull"'));
    assert.ok(remote.includes('data-action="server-off"'));
  });
});
