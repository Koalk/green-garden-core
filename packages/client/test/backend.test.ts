// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStore, emptyData, exportData, type AppData } from "@green-garden/storage";
import { LocalBackend, RemoteBackend, type FetchFn } from "../src/index.ts";

const withPlant: AppData = {
  ...emptyData(),
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      logs: [],
    },
  ],
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** A fetch that records the call and answers with a canned response (no network). */
function fake(status: number, body: unknown): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
  };
  return { fetchFn, calls };
}

function only(calls: Call[]): Call {
  const c = calls[0];
  assert.ok(c);
  return c;
}

describe("LocalBackend", () => {
  it("loads and saves through the store, never conflicting", async () => {
    const backend = new LocalBackend(new MemoryStore());
    const saved = await backend.save(withPlant, 0);
    assert.deepEqual(saved, { ok: true, revision: 0 });
    const loaded = await backend.load();
    assert.ok(loaded.ok);
    assert.equal(loaded.data.plants.length, 1);
  });
});

describe("RemoteBackend", () => {
  it("loads data and revision with the bearer token", async () => {
    const { fetchFn, calls } = fake(200, {
      revision: 3,
      data: JSON.parse(exportData(withPlant)) as unknown,
    });
    const backend = new RemoteBackend({ url: "http://localhost:8080/", token: "tok", fetchFn });
    const r = await backend.load();
    assert.ok(r.ok);
    assert.equal(r.revision, 3);
    assert.equal(r.data.plants[0]?.name, "Fern");
    assert.equal(only(calls).url, "http://localhost:8080/api/spaces/default");
    assert.equal(only(calls).headers["authorization"], "Bearer tok");
  });

  it("saves with If-Match and returns the new revision", async () => {
    const { fetchFn, calls } = fake(200, { revision: 4 });
    const backend = new RemoteBackend({ url: "http://localhost:8080", token: "tok", fetchFn });
    const r = await backend.save(withPlant, 3);
    assert.deepEqual(r, { ok: true, revision: 4 });
    assert.equal(only(calls).method, "PUT");
    assert.equal(only(calls).headers["if-match"], "3");
    assert.equal(only(calls).body, exportData(withPlant));
  });

  it("reports a conflict with the server's revision on 409", async () => {
    const { fetchFn } = fake(409, { error: "conflict", revision: 7 });
    const backend = new RemoteBackend({ url: "http://localhost:8080", token: "t", fetchFn });
    assert.deepEqual(await backend.save(withPlant, 3), {
      ok: false,
      reason: "conflict",
      revision: 7,
    });
  });

  it("maps 401 to unauthorised and a thrown fetch to unreachable", async () => {
    const denied = fake(401, { error: "unauthorised" });
    const a = new RemoteBackend({ url: "http://localhost:1", token: "x", fetchFn: denied.fetchFn });
    assert.deepEqual(await a.load(), { ok: false, reason: "unauthorised" });
    const down = new RemoteBackend({
      url: "http://localhost:1",
      token: "x",
      fetchFn: () => Promise.reject(new Error("offline")),
    });
    assert.deepEqual(await down.load(), { ok: false, reason: "unreachable" });
    assert.deepEqual(await down.save(withPlant, 0), { ok: false, reason: "unreachable" });
  });

  it("calls a garbled answer invalid", async () => {
    const { fetchFn } = fake(200, { nope: true });
    const backend = new RemoteBackend({ url: "http://localhost:1", token: "x", fetchFn });
    assert.deepEqual(await backend.load(), { ok: false, reason: "invalid" });
  });
});
