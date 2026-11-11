// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { handle, listenOptions, lanUrls, stopOnSignals } from "../dev/server.mjs";

type Res = { status: number; type: string; body: string };
const get: (p: string) => Promise<Res> = handle;

describe("dev server listen options", () => {
  it("listens on the home network by default so phones can open it", () => {
    assert.deepEqual(listenOptions({}), { host: "0.0.0.0", port: 5173 });
  });

  it("HOST and PORT override the defaults", () => {
    assert.deepEqual(listenOptions({ HOST: "127.0.0.1", PORT: "5199" }), {
      host: "127.0.0.1",
      port: 5199,
    });
  });

  it("lists LAN addresses only for external IPv4 interfaces", () => {
    const urls = lanUrls(
      {
        lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
        eth: [
          { family: "IPv4", address: "192.168.1.20", internal: false },
          { family: "IPv6", address: "fe80::1", internal: false },
        ],
      },
      5173,
    );
    assert.equal(urls.length, 1);
    assert.match(urls[0] ?? "", /\/\/192\.168\.1\.20:5173\/$/);
  });
});

describe("dev server shutdown", () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    it(`${signal} closes the server and exits with code 0, so pnpm reports no failure`, () => {
      const proc = Object.assign(new EventEmitter(), {
        code: undefined as number | undefined,
        exit(c: number) {
          this.code = c;
        },
      });
      let closed = false;
      stopOnSignals(proc, {
        close(done: () => void) {
          closed = true;
          done();
        },
      });
      proc.emit(signal);
      assert.equal(closed, true);
      assert.equal(proc.code, 0);
    });
  }

  it("start script hides the experimental type-stripping warning", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["start"] ?? "", /--disable-warning=ExperimentalWarning/);
  });
});

describe("dev server (no socket)", () => {
  it("serves the page with an import map that resolves", async () => {
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page.body);
    assert.ok(map?.[1]);
    const imports = (JSON.parse(map[1]) as { imports: Record<string, string> }).imports;
    for (const target of Object.values(imports)) {
      const r = await get(target);
      assert.equal(r.status, 200, target);
    }
  });

  it("serves every source file as browser-ready JavaScript (types stripped)", async () => {
    for (const p of [
      "/packages/engine/src/index.ts",
      "/packages/engine/src/plan.ts",
      "/packages/storage/src/index.ts",
      "/packages/storage/src/exchange.ts",
      "/packages/web-ui/src/app.ts",
      "/packages/web-ui/src/view.ts",
    ]) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.type, /text\/javascript/);
      assert.ok(!/^import type /m.test(r.body), `${p} still has type imports`);
    }
  });

  it("maps the i18n package and serves locale files as JSON modules", async () => {
    const page = await get("/");
    assert.match(page.body, /"@green-garden\/i18n": "\/packages\/i18n\/src\/index\.ts"/);
    const r = await get("/packages/i18n/src/locales/en-GB.json");
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    assert.ok(typeof (JSON.parse(r.body) as Record<string, string>)["common.save"] === "string");
  });

  it("maps every workspace package the browser code imports, client included", async () => {
    const page = await get("/");
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page.body);
    assert.ok(map?.[1]);
    const imports = (JSON.parse(map[1]) as { imports: Record<string, string> }).imports;
    const used = new Set<string>();
    for (const pkg of ["web-ui", "client", "storage", "providers", "i18n"]) {
      const dir = new URL(`../../${pkg}/src/`, import.meta.url);
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        const src = readFileSync(new URL(f, dir), "utf8");
        for (const m of src.matchAll(/from "(@green-garden\/[a-z-]+)"/g)) used.add(m[1] ?? "");
      }
    }
    for (const name of used) assert.ok(name in imports, `${name} is not in the import map`);
  });

  it("entry script is reachable from the page", async () => {
    const page = await get("/");
    const src = /<script type="module" src="([^"]+)">/.exec(page.body)?.[1];
    assert.ok(src);
    assert.equal((await get(src)).status, 200);
  });

  it("serves the bundled catalogue thumbnails as image/webp and nothing else from that folder", async () => {
    const dir = new URL("../../catalogue/thumbs/", import.meta.url);
    const name = readdirSync(dir).find((f) => f.endsWith(".webp"));
    assert.ok(name, "run the thumbnail script first");
    const ok = await get(`/catalogue-thumbs/${name}`);
    assert.equal(ok.status, 200);
    assert.match(ok.type, /^image\/webp/);
    assert.ok(Buffer.isBuffer(ok.body));
    for (const p of [
      "/catalogue-thumbs/..%2Fpackage.json",
      "/catalogue-thumbs/x.png",
      "/catalogue-thumbs/nope.webp",
      "/catalogue-thumbs/",
    ]) {
      assert.equal((await get(p)).status, 404, p);
    }
  });

  it("refuses anything outside packages/*/src and the page", async () => {
    for (const p of [
      "/package.json",
      "/packages/engine/package.json",
      "/packages/web-ui/dev/server.mjs",
      "/../secrets.md",
      "/packages/engine/src/../../../package.json",
      "/packages/engine/src/%2e%2e/%2e%2e/package.json",
      "/nope",
    ]) {
      assert.equal((await get(p)).status, 404, p);
    }
  });
});

describe("OpenPlantbook proxy", () => {
  const TOKEN = "test-token-123";
  type Call = { url: string; auth: string | undefined };

  function ctx(env: Record<string, string | undefined>, reply = '{"results":[]}', status = 200) {
    const calls: Call[] = [];
    return {
      calls,
      ctx: {
        env,
        upstream: (url: string, headers: Record<string, string>) => {
          calls.push({ url, auth: headers["Authorization"] });
          return Promise.resolve({ status, body: reply });
        },
      },
    };
  }
  const handleWith = handle as (p: string, c: ReturnType<typeof ctx>["ctx"]) => Promise<Res>;

  it("forwards a search with the token as `Authorization: Token ...`, and returns the JSON", async () => {
    const { calls, ctx: c } = ctx({ GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: TOKEN });
    const r = await handleWith("/api/openplantbook/search?alias=monstera&limit=5", c);
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    assert.equal(r.body, '{"results":[]}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.auth, `Token ${TOKEN}`);
    assert.match(calls[0].url, /\/api\/v1\/plant\/search\?alias=monstera&limit=5$/);
  });

  it("forwards a detail request for one pid", async () => {
    const { calls, ctx: c } = ctx({ GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: TOKEN });
    await handleWith("/api/openplantbook/detail?pid=monstera%20deliciosa", c);
    assert.match(calls[0]?.url ?? "", /\/api\/v1\/plant\/detail\/monstera%20deliciosa\/$/);
  });

  it("never puts the token in what the browser receives", async () => {
    const { ctx: c } = ctx({ GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: TOKEN });
    const r = await handleWith("/api/openplantbook/search?alias=x", c);
    assert.ok(!r.body.includes(TOKEN) && !r.type.includes(TOKEN));
  });

  it("answers 503 and does not call out when no token is set", async () => {
    for (const env of [{}, { GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: "" }]) {
      const { calls, ctx: c } = ctx(env);
      const r = await handleWith("/api/openplantbook/search?alias=x", c);
      assert.equal(r.status, 503);
      assert.equal(calls.length, 0);
    }
  });

  it("refuses other paths and malformed queries under the proxy prefix", async () => {
    const env = { GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: TOKEN };
    for (const p of [
      "/api/openplantbook/other",
      "/api/openplantbook/search",
      "/api/openplantbook/detail",
      "/api/openplantbook/detail?pid=../../admin",
      "/api/openplantbook/detail?pid=a/b",
      "/api/other",
    ]) {
      const { calls, ctx: c } = ctx(env);
      const r = await handleWith(p, c);
      assert.ok(r.status === 400 || r.status === 404, `${p} gave ${r.status}`);
      assert.equal(calls.length, 0, p);
    }
  });

  it("passes an upstream failure on as 502 without its body", async () => {
    const { ctx: c } = ctx({ GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN: TOKEN }, "secret detail", 401);
    const r = await handleWith("/api/openplantbook/search?alias=x", c);
    assert.equal(r.status, 502);
    assert.ok(!r.body.includes("secret detail"));
  });

  it("the .env file and the token are not servable", async () => {
    for (const p of ["/.env", "/packages/web-ui/.env", "/green-garden-core/.env"])
      assert.equal((await get(p)).status, 404, p);
  });
});

describe("loadEnv", () => {
  it("reads KEY=value lines, skips comments and blanks, strips quotes", async () => {
    const { loadEnv } = (await import("../dev/server.mjs")) as unknown as {
      loadEnv: (t: string) => Record<string, string>;
    };
    assert.deepEqual(loadEnv("# c\n\nA=1\nB = \"two\"\nC=\nD=x=y\n  # more\nE='q'\n"), {
      A: "1",
      B: "two",
      C: "",
      D: "x=y",
      E: "q",
    });
  });
});

describe("dev server Home Assistant proxy", () => {
  const TOKEN = "ha-secret-token";
  const URL_ = "http://localhost:8123";
  const recorded = readFileSync(
    new URL("../../providers/test/fixtures/ha-areas-template.txt", import.meta.url),
    "utf8",
  );

  interface Seen {
    url: string;
    auth: string | undefined;
    body: string;
  }
  function ctx(env: Record<string, string | undefined>, status = 200, reply = recorded) {
    const seen: Seen[] = [];
    return {
      seen,
      ctx: {
        env,
        haPost: (url: string, init: { headers: Record<string, string>; body: string }) => {
          seen.push({ url, auth: init.headers["Authorization"], body: init.body });
          return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(reply),
          });
        },
      },
    };
  }
  const run = handle as (p: string, c: ReturnType<typeof ctx>["ctx"]) => Promise<Res>;

  it("asks Home Assistant with the token and returns the areas, never the token", async () => {
    const { seen, ctx: c } = ctx({
      GREEN_GARDEN_HA_URL: URL_,
      GREEN_GARDEN_HA_TOKEN: TOKEN,
    });
    const r = await run("/api/homeassistant/areas", c);
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    const body = JSON.parse(r.body) as { areas: { id: string; name: string }[] };
    assert.deepEqual(
      body.areas.map((a) => a.id),
      ["bedroom", "hallway", "kitchen", "living_room"],
    );
    assert.ok(!r.body.includes(TOKEN));
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.url, `${URL_}/api/template`);
    assert.equal(call.auth, `Bearer ${TOKEN}`);
  });

  it("answers 503 not_configured without calling anything when the address or token is empty", async () => {
    for (const env of [
      {},
      { GREEN_GARDEN_HA_URL: URL_ },
      { GREEN_GARDEN_HA_TOKEN: TOKEN },
      { GREEN_GARDEN_HA_URL: "", GREEN_GARDEN_HA_TOKEN: "" },
    ]) {
      const { seen, ctx: c } = ctx(env);
      const r = await run("/api/homeassistant/areas", c);
      assert.equal(r.status, 503);
      assert.deepEqual(JSON.parse(r.body), { error: "not_configured" });
      assert.equal(seen.length, 0);
    }
  });

  it("maps a refused token and a broken Home Assistant to 502 with a reason", async () => {
    const env = { GREEN_GARDEN_HA_URL: URL_, GREEN_GARDEN_HA_TOKEN: TOKEN };
    const refused = await run("/api/homeassistant/areas", ctx(env, 401).ctx);
    assert.equal(refused.status, 502);
    assert.deepEqual(JSON.parse(refused.body), { error: "unauthorised" });
    const down = await run("/api/homeassistant/areas", ctx(env, 500).ctx);
    assert.deepEqual(JSON.parse(down.body), { error: "unreachable" });
    const junk = await run("/api/homeassistant/areas", ctx(env, 200, "oops").ctx);
    assert.deepEqual(JSON.parse(junk.body), { error: "bad_response" });
    assert.ok(![refused.body, down.body, junk.body].some((b) => b.includes(TOKEN)));
  });

  it("serves nothing else under the prefix", async () => {
    const { ctx: c } = ctx({ GREEN_GARDEN_HA_URL: URL_, GREEN_GARDEN_HA_TOKEN: TOKEN });
    for (const p of [
      "/api/homeassistant",
      "/api/homeassistant/states",
      "/api/homeassistant/areas/x",
    ]) {
      assert.equal((await run(p, c)).status, 404, p);
    }
  });
});

describe("self-hosted stylesheet", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("serves Pico CSS from the dependency as text/css", async () => {
    const r = await get("/vendor/pico.green.min.css");
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/css/);
    assert.match(r.body, /Pico CSS/);
  });

  it("serves nothing else from node_modules", async () => {
    for (const p of ["/vendor/other.css", "/vendor/../package.json", "/node_modules/.modules.yaml"])
      assert.equal((await get(p)).status, 404, p);
  });

  it("index.html links the local copy, follows the system light/dark setting and loads nothing remote", () => {
    assert.match(html, /<link rel="stylesheet" href="\/vendor\/pico\.green\.min\.css"/);
    assert.match(html, /<meta name="color-scheme" content="light dark"/);
    assert.doesNotMatch(html, /(?:href|src)="https?:/);
  });

  it("keeps colours in theme variables so dark mode works", () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    assert.doesNotMatch(style, /#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("dev server rain proxy", () => {
  type Weather = { report(p: { lat: number; lon: number }, today: string): Promise<unknown> };
  const run = handle as (p: string, c: { weather?: Weather; now?: () => Date }) => Promise<Res>;
  const now = (): Date => new Date("2026-11-07T10:00:00Z");

  it("says 503 when no weather service is set up", async () => {
    const r = await run("/api/weather?lat=51.5&lon=-0.12&today=2026-11-07", { now });
    assert.equal(r.status, 503);
  });

  it("passes the point and the local date to the service and returns its report", async () => {
    const seen: unknown[] = [];
    const weather: Weather = {
      report: (p, today) => {
        seen.push([p, today]);
        return Promise.resolve({ days: [], fetchedAt: "x" });
      },
    };
    const r = await run("/api/weather?lat=51.5&lon=-0.12&today=2026-11-07", { weather, now });
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    assert.deepEqual(seen, [[{ lat: 51.5, lon: -0.12 }, "2026-11-07"]]);
    assert.deepEqual(JSON.parse(r.body), { days: [], fetchedAt: "x" });
  });

  it("refuses a bad point or date", async () => {
    const weather: Weather = { report: () => Promise.resolve({}) };
    for (const q of ["", "?lat=1", "?lat=99&lon=0&today=2026-11-07", "?lat=1&lon=1&today=nope"]) {
      const r = await run(`/api/weather${q}`, { weather, now });
      assert.equal(r.status, 400, q);
    }
  });

  it("answers 502 when the service throws", async () => {
    const weather: Weather = { report: () => Promise.reject(new Error("boom")) };
    const r = await run("/api/weather?lat=1&lon=1&today=2026-11-07", { weather, now });
    assert.equal(r.status, 502);
  });
});
