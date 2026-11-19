// SPDX-License-Identifier: AGPL-3.0-only
// Dependency-free dev server: serves index.html and the packages' TypeScript sources, stripping
// types on the fly (Node's built-in), so no bundler or build step is needed. Development only:
// it listens on the home network by default so phones can open it; HOST=127.0.0.1 keeps it local.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HomeAssistantAreas, buildWeatherService } from "@green-garden/providers";

const PICO = createRequire(import.meta.url).resolve("@picocss/pico/css/pico.green.min.css");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TYPES = {
  ".html": "text/html",
  ".ts": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
};

const OPB = "https://open.plantbook.io/api/v1/plant";
const JSON_TYPE = "application/json; charset=utf-8";
const text = (status, body) => ({ status, type: "text/plain", body });

/** KEY=value lines (comments, blanks and surrounding quotes handled), for the gitignored .env. */
export function loadEnv(src) {
  const out = {};
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m === null) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

function readDotEnv() {
  try {
    return loadEnv(readFileSync(join(repo, ".env"), "utf8"));
  } catch {
    return {};
  }
}

async function realUpstream(url, headers) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.text() };
}

/**
 * Local proxy for OpenPlantbook so the browser never sees the token (read from .env). Only the two
 * calls the UI needs are forwarded; anything else under the prefix is refused.
 */
async function openPlantbook(urlPath, ctx) {
  const url = new URL(urlPath, "http://localhost");
  const token = (ctx.env ?? {}).GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN;
  let target;
  if (url.pathname === "/api/openplantbook/search") {
    const alias = url.searchParams.get("alias") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 8);
    if (alias.trim() === "" || alias.length > 80) return text(400, "bad query");
    const n = Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 8;
    target = `${OPB}/search?alias=${encodeURIComponent(alias)}&limit=${n}`;
  } else if (url.pathname === "/api/openplantbook/detail") {
    const pid = url.searchParams.get("pid") ?? "";
    if (!/^[\p{L}\p{N} ._'()-]{1,100}$/u.test(pid) || pid.includes("..")) {
      return text(400, "bad pid");
    }
    target = `${OPB}/detail/${encodeURIComponent(pid)}/`;
  } else return text(404, "not found");
  if (token === undefined || token === "") {
    return text(
      503,
      "OpenPlantbook is not configured: set GREEN_GARDEN_OPENPLANTBOOK_API_TOKEN in .env",
    );
  }
  try {
    const res = await (ctx.upstream ?? realUpstream)(target, { Authorization: `Token ${token}` });
    if (res.status !== 200) return text(502, "OpenPlantbook did not answer");
    return { status: 200, type: JSON_TYPE, body: res.body };
  } catch {
    return text(502, "OpenPlantbook did not answer");
  }
}

async function realPost(url, init) {
  const res = await fetch(url, { method: "POST", ...init });
  return { ok: res.ok, status: res.status, text: () => res.text() };
}

/**
 * Local proxy for Home Assistant: the address and the long-lived token come from .env and never reach
 * the browser. Only the area list is served.
 */
async function homeAssistantAreas(ctx) {
  const env = ctx.env ?? {};
  const source = new HomeAssistantAreas(
    env.GREEN_GARDEN_HA_URL,
    env.GREEN_GARDEN_HA_TOKEN,
    ctx.haPost ?? realPost,
  );
  const r = await source.listAreas();
  if (r.ok) return { status: 200, type: JSON_TYPE, body: JSON.stringify({ areas: r.areas }) };
  const status = r.reason === "not_configured" ? 503 : 502;
  return { status, type: JSON_TYPE, body: JSON.stringify({ error: r.reason }) };
}

/**
 * Local rain proxy: the browser sends a rounded home point and its local date; the service (keys
 * from .env, an hour of cache) picks the gauge and answers with days, provenance and credit lines.
 */
async function weatherRoute(urlPath, ctx) {
  if (ctx.weather === undefined) {
    return {
      status: 503,
      type: JSON_TYPE,
      body: JSON.stringify({ error: "weather not configured" }),
    };
  }
  const q = new URL(urlPath, "http://localhost").searchParams;
  const num = (k) => (q.get(k)?.trim() ? Number(q.get(k)) : Number.NaN);
  const lat = num("lat");
  const lon = num("lon");
  const today = q.get("today") ?? "";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(today) ? Date.parse(`${today}T00:00:00Z`) : Number.NaN;
  const nowMs = (ctx.now ?? (() => new Date()))().getTime();
  if (
    !(Math.abs(lat) <= 90) ||
    !(Math.abs(lon) <= 180) ||
    !Number.isFinite(t) ||
    Math.abs(t - nowMs) > 3 * 86_400_000
  ) {
    return { status: 400, type: JSON_TYPE, body: JSON.stringify({ error: "bad query" }) };
  }
  try {
    const report = await ctx.weather.report({ lat, lon }, today);
    return { status: 200, type: JSON_TYPE, body: JSON.stringify(report) };
  } catch {
    return { status: 502, type: JSON_TYPE, body: JSON.stringify({ error: "unreachable" }) };
  }
}

/** Pure request handler, so tests need no socket: returns { status, type, body }. */
export async function handle(urlPath, ctx = {}) {
  const route = urlPath.split("?")[0];
  if (route.startsWith("/api/")) {
    if (route === "/api/homeassistant/areas") return homeAssistantAreas(ctx);
    if (route === "/api/weather") return weatherRoute(urlPath, ctx);
    return route.startsWith("/api/openplantbook/")
      ? openPlantbook(urlPath, ctx)
      : text(404, "not found");
  }
  // The one stylesheet (Pico CSS, MIT, a dependency of this package), self-hosted: no CDN.
  if (route === "/vendor/pico.green.min.css") {
    return { status: 200, type: "text/css; charset=utf-8", body: await readFile(PICO, "utf8") };
  }
  // Bundled catalogue thumbnails: the folder is flat and holds only <id>.webp.
  const thumb = /^\/catalogue-thumbs\/([a-z0-9][a-z0-9-]*\.webp)$/.exec(route);
  if (thumb !== null) {
    try {
      const body = await readFile(join(repo, "packages", "catalogue", "thumbs", thumb[1]));
      return { status: 200, type: "image/webp", body };
    } catch {
      return { status: 404, type: "text/plain", body: "not found" };
    }
  }
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const rel = clean === "/" ? "/packages/web-ui/index.html" : clean;
  const full = normalize(join(repo, rel));
  const parts = rel.split("/").filter(Boolean);
  const allowed =
    rel === "/packages/web-ui/index.html" ||
    (parts[0] === "packages" && parts[2] === "src" && /\.(ts|js|json)$/.test(rel));
  if (!allowed || !full.startsWith(repo + sep) || rel.includes("..")) {
    return { status: 404, type: "text/plain", body: "not found" };
  }
  try {
    const src = await readFile(full, "utf8");
    const ext = rel.slice(rel.lastIndexOf("."));
    const body = ext === ".ts" ? stripTypeScriptTypes(src) : src;
    return { status: 200, type: `${TYPES[ext] ?? "text/plain"}; charset=utf-8`, body };
  } catch {
    return { status: 404, type: "text/plain", body: "not found" };
  }
}

/** Host and port from the environment: all interfaces on 5173 unless HOST or PORT say otherwise. */
export function listenOptions(env) {
  return { host: env.HOST ?? "0.0.0.0", port: Number(env.PORT ?? 5173) };
}

/** URLs a phone on the same network can open, from `os.networkInterfaces()` output. */
export function lanUrls(interfaces, port) {
  return Object.values(interfaces)
    .flat()
    .filter((a) => a !== undefined && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a.address}:${port}/`);
}

/** Ctrl+C or a kill closes the server and exits with 0, so pnpm and mise do not report a failure. */
export function stopOnSignals(proc, server) {
  const stop = () => server.close(() => proc.exit(0));
  proc.once("SIGINT", stop);
  proc.once("SIGTERM", stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { host, port } = listenOptions(process.env);
  const env = { ...readDotEnv(), ...process.env };
  // The dev server keeps its rain cache in memory (an hour); the self-hosted server keeps it in a file.
  let memo;
  const weather = buildWeatherService({
    fetcher: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    store: { load: () => Promise.resolve(memo), save: (v) => ((memo = v), Promise.resolve()) },
    now: () => new Date(),
    ...(env.GREEN_GARDEN_AEMET_KEY ? { aemetKey: env.GREEN_GARDEN_AEMET_KEY } : {}),
    ...(env.GREEN_GARDEN_SEPA_KEY ? { sepaKey: env.GREEN_GARDEN_SEPA_KEY } : {}),
    log: (line) => console.log(line),
  });
  const server = createServer((req, res) => {
    void handle(req.url ?? "/", { env, weather }).then((r) => {
      res.writeHead(r.status, { "content-type": r.type, "cache-control": "no-store" });
      res.end(r.body);
    });
  }).listen(port, host, () => {
    console.log(`Green Garden Core (provisional UI): http://localhost:${port}/`);
    if (host === "0.0.0.0") {
      for (const url of lanUrls(networkInterfaces(), port))
        console.log(`  on your network: ${url}`);
    }
  });
  stopOnSignals(process, server);
}
