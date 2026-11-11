// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { emptyData, exportData, type AppData } from "@green-garden/storage";
import { createApp, type App, type Reply } from "../src/index.ts";

const TOKEN = "test-token";
let dir = "";
let app: App;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-server-"));
  app = createApp({ dir, token: TOKEN, now: () => new Date(2026, 10, 2, 9, 0) });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };

function body(r: Reply): Record<string, unknown> {
  return JSON.parse(r.body) as Record<string, unknown>;
}

function withPlant(name: string): AppData {
  return {
    ...emptyData(),
    plants: [{ id: "p1", spaceId: "space1", name, style: "keep_moist", intervalDays: 4, logs: [] }],
  };
}

function put(data: AppData, revision: number, headers = auth): Promise<Reply> {
  return app.handle({
    method: "PUT",
    path: "/api/spaces/default",
    headers: { ...headers, "if-match": String(revision) },
    body: exportData(data),
  });
}

describe("server JSON API", () => {
  it("refuses requests without the bearer token", async () => {
    const none = await app.handle({ method: "GET", path: "/api/spaces/default", headers: {} });
    assert.equal(none.status, 401);
    const wrong = await app.handle({
      method: "GET",
      path: "/api/spaces/default",
      headers: { authorization: "Bearer nope" },
    });
    assert.equal(wrong.status, 401);
  });

  it("returns empty data at revision 0 before anything is saved", async () => {
    const r = await app.handle({ method: "GET", path: "/api/spaces/default", headers: auth });
    assert.equal(r.status, 200);
    assert.equal(body(r)["revision"], 0);
    assert.deepEqual((body(r)["data"] as { plants: unknown[] }).plants, []);
  });

  it("saves, bumps the revision and reads the data back", async () => {
    const saved = await put(withPlant("Fern"), 0);
    assert.equal(saved.status, 200);
    assert.equal(body(saved)["revision"], 1);
    const r = await app.handle({ method: "GET", path: "/api/spaces/default", headers: auth });
    assert.equal(body(r)["revision"], 1);
    const plants = (body(r)["data"] as { plants: { name: string }[] }).plants;
    assert.equal(plants[0]?.name, "Fern");
  });

  it("answers 409 with the current revision when the base is stale", async () => {
    await put(withPlant("Fern"), 0);
    const stale = await put(withPlant("Other device"), 0);
    assert.equal(stale.status, 409);
    assert.deepEqual(body(stale), { error: "conflict", revision: 1 });
    const r = await app.handle({ method: "GET", path: "/api/spaces/default", headers: auth });
    const plants = (body(r)["data"] as { plants: { name: string }[] }).plants;
    assert.equal(plants[0]?.name, "Fern", "the stale save changed nothing");
  });

  it("rejects a missing If-Match, junk bodies and bad space names", async () => {
    const noMatch = await app.handle({
      method: "PUT",
      path: "/api/spaces/default",
      headers: auth,
      body: exportData(emptyData()),
    });
    assert.equal(noMatch.status, 428);
    const junk = await app.handle({
      method: "PUT",
      path: "/api/spaces/default",
      headers: { ...auth, "if-match": "0" },
      body: "{nope",
    });
    assert.equal(junk.status, 400);
    const bad = await app.handle({ method: "GET", path: "/api/spaces/..%2Fetc", headers: auth });
    assert.equal(bad.status, 404);
  });

  it("keeps each space in its own JSON file and leaves no temp files behind", async () => {
    await put(withPlant("Fern"), 0);
    await app.handle({
      method: "PUT",
      path: "/api/spaces/office",
      headers: { ...auth, "if-match": "0" },
      body: exportData(withPlant("Cactus")),
    });
    assert.deepEqual(readdirSync(dir).sort(), ["default.json", "office.json"]);
  });

  it("answers CORS preflight so the web UI on another port can call it", async () => {
    const r = await app.handle({
      method: "OPTIONS",
      path: "/api/spaces/default",
      headers: { origin: "http://localhost:5173" },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers["access-control-allow-origin"], "*");
    assert.match(r.headers["access-control-allow-headers"] ?? "", /authorization/);
  });
});

describe("server keeps what it was sent", () => {
  const sent = JSON.stringify({
    format: "green-garden-export",
    version: 9,
    stories: { xp: 5 },
    plants: [{ id: "p1", name: "A", style: "keep_moist", intervalDays: 4, logs: [], extra: 1 }],
    rooms: [],
    settings: { futureSetting: true },
  });
  const putRaw = (text: string, revision: number): Promise<Reply> =>
    app.handle({
      method: "PUT",
      path: "/api/spaces/default",
      headers: { ...auth, "if-match": String(revision) },
      body: text,
    });
  const read = async (): Promise<Record<string, unknown>> =>
    body(await app.handle({ method: "GET", path: "/api/spaces/default", headers: auth }));

  it("stores the body as sent, unknown keys included", async () => {
    assert.equal((await putRaw(sent, 0)).status, 200);
    assert.deepEqual((await read())["data"], JSON.parse(sent));
  });

  it("stores a plant this build cannot read instead of dropping it", async () => {
    const odd = JSON.stringify({
      ...JSON.parse(sent),
      plants: [{ id: "p9", name: "Odd", style: "mist_weekly", intervalDays: 3 }],
    });
    await putRaw(odd, 0);
    assert.deepEqual((await read())["data"], JSON.parse(odd));
  });

  it("refuses a PUT whose version is lower than the stored one", async () => {
    await putRaw(sent, 0);
    const older = JSON.stringify({ ...JSON.parse(sent), version: 8 });
    const r = await putRaw(older, 1);
    assert.equal(r.status, 422);
    assert.equal(body(r)["error"], "version lower than stored");
    assert.equal((await read())["revision"], 1);
  });

  it("still answers 400 for text that is not an export", async () => {
    assert.equal((await putRaw("[1]", 0)).status, 400);
  });
});
