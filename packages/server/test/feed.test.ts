// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { emptyData, exportData, makePlan, planToIcs, type AppData } from "@green-garden/storage";
import { createApp, type App, type Reply } from "../src/index.ts";

const TOKEN = "test-token";
const NOW = new Date(2026, 10, 2, 9, 0); // 2026-11-02, local time
const TODAY = "2026-11-02";
let dir = "";
let app: App;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-feed-"));
  app = createApp({ dir, token: TOKEN, now: () => NOW });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };

const data: AppData = {
  ...emptyData(),
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Fern",
      style: "keep_moist",
      intervalDays: 4,
      lastWatered: "2026-11-01",
      logs: [],
    },
  ],
};

async function save(): Promise<void> {
  const r = await app.handle({
    method: "PUT",
    path: "/api/spaces/default",
    headers: { ...auth, "if-match": "0" },
    body: exportData(data),
  });
  assert.equal(r.status, 200);
}

async function feedToken(path = "/api/spaces/default/feed-token", method = "GET"): Promise<string> {
  const r: Reply = await app.handle({ method, path, headers: auth });
  assert.equal(r.status, 200);
  return (JSON.parse(r.body) as { token: string }).token;
}

describe("calendar feed", () => {
  it("serves the same engine output as the .ics export, without the bearer token", async () => {
    await save();
    const token = await feedToken();
    const r = await app.handle({ method: "GET", path: `/calendar/${token}.ics`, headers: {} });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"] ?? "", /^text\/calendar/);
    const expected = planToIcs(makePlan(data, TODAY), data, TODAY, (n) =>
      n === 1 ? "Water 1 plant" : `Water ${String(n)} plants`,
    );
    assert.equal(r.body, expected);
    assert.ok(r.body.includes("SUMMARY:Water 1 plant"));
  });

  it("uses an unguessable token and keeps it stable until rotated", async () => {
    await save();
    const a = await feedToken();
    assert.match(a, /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(await feedToken(), a, "stable");
  });

  it("rotating makes the old URL stop working", async () => {
    await save();
    const old = await feedToken();
    const fresh = await feedToken("/api/spaces/default/feed-token", "POST");
    assert.notEqual(fresh, old);
    const gone = await app.handle({ method: "GET", path: `/calendar/${old}.ics`, headers: {} });
    assert.equal(gone.status, 404);
    const ok = await app.handle({ method: "GET", path: `/calendar/${fresh}.ics`, headers: {} });
    assert.equal(ok.status, 200);
  });

  it("does not hand the token out without the bearer token, and 404s unknown tokens", async () => {
    const r = await app.handle({
      method: "GET",
      path: "/api/spaces/default/feed-token",
      headers: {},
    });
    assert.equal(r.status, 401);
    const nope = await app.handle({ method: "GET", path: "/calendar/abc.ics", headers: {} });
    assert.equal(nope.status, 404);
  });

  it("keeps the token when data is saved again", async () => {
    await save();
    const token = await feedToken();
    const r = await app.handle({
      method: "PUT",
      path: "/api/spaces/default",
      headers: { ...auth, "if-match": "1" },
      body: exportData(data),
    });
    assert.equal(r.status, 200);
    assert.equal(await feedToken(), token);
  });
});
