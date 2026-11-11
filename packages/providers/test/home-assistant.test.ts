// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HA_AREAS_TEMPLATE,
  HomeAssistantAreas,
  ProxyAreas,
  parseHaAreas,
  type Poster,
} from "../src/index.ts";

/** A recorded answer of Home Assistant's template endpoint (no live Home Assistant is ever called). */
const recorded = readFileSync(new URL("fixtures/ha-areas-template.txt", import.meta.url), "utf8");

const answer = (status: number, body: string) => () =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) });

describe("parseHaAreas", () => {
  it("reads the recorded template output, sorted by name", () => {
    assert.deepEqual(parseHaAreas(recorded), [
      { id: "bedroom", name: "Bedroom" },
      { id: "hallway", name: "Hallway" },
      { id: "kitchen", name: "Kitchen" },
      { id: "living_room", name: "Living Room" },
    ]);
  });

  it("skips entries without an id or a name and drops duplicates", () => {
    const text = JSON.stringify([
      { id: "a", name: "A" },
      { id: "a", name: "A again" },
      { id: "", name: "No id" },
      { id: "b" },
      { name: "No id either" },
      "junk",
      { id: "c", name: "  C  " },
    ]);
    assert.deepEqual(parseHaAreas(text), [
      { id: "a", name: "A" },
      { id: "c", name: "C" },
    ]);
  });

  it("gives nothing for text that is not a JSON list", () => {
    assert.deepEqual(parseHaAreas("not json"), []);
    assert.deepEqual(parseHaAreas('{"id": "a"}'), []);
    assert.deepEqual(parseHaAreas(""), []);
  });
});

describe("HomeAssistantAreas (REST template endpoint)", () => {
  it("posts the template with the token as a bearer header, and returns the areas", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const post: Poster = (url, init) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return answer(200, recorded)();
    };
    const source = new HomeAssistantAreas("http://localhost:8123/", "secret-token", post);
    const r = await source.listAreas();
    assert.ok(r.ok);
    assert.equal(r.areas.length, 4);
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.url, "http://localhost:8123/api/template");
    assert.equal(call.headers["Authorization"], "Bearer secret-token");
    assert.equal(call.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.body), { template: HA_AREAS_TEMPLATE });
  });

  it("the template asks for area ids and names as JSON", () => {
    assert.match(HA_AREAS_TEMPLATE, /areas\(\)/);
    assert.match(HA_AREAS_TEMPLATE, /area_name/);
    assert.match(HA_AREAS_TEMPLATE, /tojson/);
  });

  it("says not configured when the address or the token is missing or not http(s)", async () => {
    const never: Poster = () => Promise.reject(new Error("must not be called"));
    for (const [url, token] of [
      [undefined, "t"],
      ["", "t"],
      ["http://localhost:8123", undefined],
      ["http://localhost:8123", ""],
      ["ftp://localhost:8123", "t"],
      ["not a url", "t"],
    ] as const) {
      assert.deepEqual(await new HomeAssistantAreas(url, token, never).listAreas(), {
        ok: false,
        reason: "not_configured",
      });
    }
  });

  it("maps 401 and 403 to unauthorised, other statuses and a network error to unreachable", async () => {
    const run = (post: Poster) =>
      new HomeAssistantAreas("http://localhost:8123", "t", post).listAreas();
    assert.deepEqual(await run(answer(401, "")), { ok: false, reason: "unauthorised" });
    assert.deepEqual(await run(answer(403, "")), { ok: false, reason: "unauthorised" });
    assert.deepEqual(await run(answer(500, "")), { ok: false, reason: "unreachable" });
    assert.deepEqual(await run(() => Promise.reject(new Error("down"))), {
      ok: false,
      reason: "unreachable",
    });
  });

  it("an answer that is not a list is a bad response, an empty list is fine", async () => {
    const run = (body: string) =>
      new HomeAssistantAreas("http://localhost:8123", "t", answer(200, body)).listAreas();
    assert.deepEqual(await run("Error rendering template"), { ok: false, reason: "bad_response" });
    assert.deepEqual(await run("[]"), { ok: true, areas: [] });
  });
});

describe("ProxyAreas (what the browser calls)", () => {
  const reply = (status: number, json: unknown) => () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
    });

  it("reads the areas from the local proxy path", async () => {
    const seen: string[] = [];
    const source = new ProxyAreas((url) => {
      seen.push(url);
      return reply(200, { areas: [{ id: "kitchen", name: "Kitchen" }] })();
    });
    assert.deepEqual(await source.listAreas(), {
      ok: true,
      areas: [{ id: "kitchen", name: "Kitchen" }],
    });
    assert.deepEqual(seen, ["/api/homeassistant/areas"]);
  });

  it("passes the proxy's reason through, and treats anything else as unreachable", async () => {
    const run = (status: number, json: unknown) => new ProxyAreas(reply(status, json)).listAreas();
    assert.deepEqual(await run(503, { error: "not_configured" }), {
      ok: false,
      reason: "not_configured",
    });
    assert.deepEqual(await run(502, { error: "unauthorised" }), {
      ok: false,
      reason: "unauthorised",
    });
    assert.deepEqual(await run(502, { error: "something else" }), {
      ok: false,
      reason: "unreachable",
    });
    assert.deepEqual(await run(200, { nope: 1 }), { ok: false, reason: "bad_response" });
    const down = new ProxyAreas(() => Promise.reject(new Error("offline")));
    assert.deepEqual(await down.listAreas(), { ok: false, reason: "unreachable" });
  });
});
