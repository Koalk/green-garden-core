// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createApp, type App } from "@green-garden/server";
import { emptyData, type AppData } from "@green-garden/storage";
import { RemoteBackend, type FetchFn } from "../src/index.ts";

const TOKEN = "integration-token";
let dir = "";
let app: App;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-int-"));
  app = createApp({ dir, token: TOKEN, now: () => new Date(2026, 10, 2, 9, 0) });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The client's fetch, answered by the server's handler in-process: no socket, no network. */
const toServer: FetchFn = async (url, init) => {
  const path = url.replace("http://localhost:8080", "");
  const r = await app.handle({
    method: init.method,
    path,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return { status: r.status, text: () => Promise.resolve(r.body) };
};

function device(token = TOKEN): RemoteBackend {
  return new RemoteBackend({ url: "http://localhost:8080", token, fetchFn: toServer });
}

function named(name: string): AppData {
  return {
    ...emptyData(),
    plants: [{ id: "p1", spaceId: "space1", name, style: "keep_moist", intervalDays: 4, logs: [] }],
  };
}

describe("client against server", () => {
  it("round-trips data between two devices", async () => {
    const a = device();
    const b = device();
    const first = await a.load();
    assert.ok(first.ok);
    assert.equal(first.revision, 0);
    assert.deepEqual(await a.save(named("Fern"), 0), { ok: true, revision: 1 });
    const seen = await b.load();
    assert.ok(seen.ok);
    assert.equal(seen.revision, 1);
    assert.equal(seen.data.plants[0]?.name, "Fern");
  });

  it("two devices cannot silently overwrite each other", async () => {
    const a = device();
    const b = device();
    await a.save(named("From A"), 0);
    const clash = await b.save(named("From B"), 0);
    assert.deepEqual(clash, { ok: false, reason: "conflict", revision: 1 });
    const now = await a.load();
    assert.ok(now.ok);
    assert.equal(now.data.plants[0]?.name, "From A", "A's data survived");
    const retry = await b.save(named("From B"), 1);
    assert.deepEqual(retry, { ok: true, revision: 2 });
  });

  it("a wrong token is unauthorised", async () => {
    assert.deepEqual(await device("wrong").load(), { ok: false, reason: "unauthorised" });
  });
});
