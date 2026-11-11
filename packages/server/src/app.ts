// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The server as a pure request handler (no socket), so tests run it in-process and the no-network gate
 * stays green. `http.ts` puts it on a port. Routes:
 *   GET/PUT /api/spaces/<name>            bearer token; PUT needs If-Match: <revision>, 409 when stale
 *   GET/POST /api/spaces/<name>/feed-token   bearer token; read or rotate the calendar feed token
 *   GET /api/weather?lat&lon&today        bearer token; rain for a rounded home point, cached an hour
 *   GET /calendar/<feed-token>.ics        no bearer token: the unguessable token is the secret
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { WeatherService } from "@green-garden/providers";
import { emptyData, exportData, importData, makePlan, planToIcs } from "@green-garden/storage";
import { localDate } from "./clock.ts";
import { SpaceFiles, newFeedToken, validSpaceName, type SpaceFile } from "./files.ts";

export interface Req {
  readonly method: string;
  /** Path and query as sent, not decoded. */
  readonly path: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
}

export interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface AppOptions {
  /** Data directory, one JSON file per space. */
  readonly dir: string;
  /** The bearer token (GREEN_GARDEN_SERVER_TOKEN); must not be empty. */
  readonly token: string;
  /** The clock, injected so tests are deterministic. */
  readonly now: () => Date;
  /** Rain from the weather sources; without it `/api/weather` answers 503. */
  readonly weather?: WeatherService;
}

export interface App {
  handle(req: Req): Promise<Reply>;
  readonly files: SpaceFiles;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, if-match",
  "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
};

function json(status: number, value: unknown): Reply {
  return {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(value),
  };
}

/** The `version` of an export document, 0 when there is none. */
function versionOf(doc: unknown): number {
  const v = typeof doc === "object" && doc !== null ? (doc as { version?: unknown }).version : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function createApp(options: AppOptions): App {
  if (options.token === "") throw new Error("the server token must not be empty");
  const files = new SpaceFiles(options.dir);

  function authorised(req: Req): boolean {
    const m = /^Bearer (.+)$/.exec(req.headers["authorization"] ?? "");
    return m?.[1] !== undefined && sameSecret(m[1], options.token);
  }

  async function getSpace(name: string): Promise<Reply> {
    const file = await files.read(name);
    return json(200, {
      revision: file?.revision ?? 0,
      data: file?.data ?? (JSON.parse(exportData(emptyData())) as unknown),
    });
  }

  async function putSpace(name: string, req: Req): Promise<Reply> {
    const ifMatch = req.headers["if-match"];
    if (ifMatch === undefined || !/^\d+$/.test(ifMatch)) {
      return json(428, { error: "if-match required" });
    }
    const imported = importData(req.body ?? "");
    if (imported.issues.some((i) => i.code === "import.notJson" || i.code === "import.notExport")) {
      return json(400, { error: "not a green-garden export" });
    }
    // the format check passed, so the body is stored as it was sent; a re-serialised copy would
    // drop every key this build does not know (the Stories app's own section among them).
    const data = JSON.parse(req.body ?? "") as unknown;
    const sentVersion = versionOf(data);
    const base = Number(ifMatch);
    return files.update(name, (current) => {
      const revision = current?.revision ?? 0;
      if (revision !== base) return { result: json(409, { error: "conflict", revision }) };
      const stored = versionOf(current?.data);
      if (sentVersion < stored)
        return { result: json(422, { error: "version lower than stored" }) };
      return {
        file: { ...current, revision: revision + 1, data },
        result: json(200, { revision: revision + 1 }),
      };
    });
  }

  async function feedToken(name: string, rotate: boolean): Promise<Reply> {
    const token = await files.update(name, (current) => {
      const existing = current?.feedToken;
      if (existing !== undefined && !rotate) return { result: existing };
      const feedToken = newFeedToken();
      const file: SpaceFile = current
        ? { ...current, feedToken }
        : { revision: 0, feedToken, data: JSON.parse(exportData(emptyData())) as unknown };
      return { file, result: feedToken };
    });
    return json(200, { token });
  }

  /** The watering plan of the space owning `token`, as the same `.ics` the UI exports. */
  async function feed(token: string): Promise<Reply> {
    for (const name of await files.names()) {
      const file = await files.read(name);
      if (file?.feedToken === undefined || !sameSecret(file.feedToken, token)) continue;
      const data = importData(JSON.stringify(file.data)).data;
      const today = localDate(options.now());
      const body = planToIcs(makePlan(data, today), data, today, (n) =>
        n === 1 ? "Water 1 plant" : `Water ${String(n)} plants`,
      );
      return {
        status: 200,
        headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" },
        body,
      };
    }
    return json(404, { error: "not found" });
  }

  /** Rain for a home point. The point is rounded again by the service; `today` is the caller's local date. */
  async function weather(query: string): Promise<Reply> {
    if (options.weather === undefined) return json(503, { error: "weather not configured" });
    const q = new URLSearchParams(query);
    const num = (k: string): number | undefined => {
      const v = q.get(k);
      return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
    };
    const lat = num("lat");
    const lon = num("lon");
    const today = q.get("today") ?? "";
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json(400, { error: "lat and lon needed" });
    }
    const t = /^\d{4}-\d{2}-\d{2}$/.test(today) ? Date.parse(`${today}T00:00:00Z`) : Number.NaN;
    if (!Number.isFinite(t) || Math.abs(t - options.now().getTime()) > 3 * 86_400_000) {
      return json(400, { error: "today must be a date within a few days of now" });
    }
    return json(200, await options.weather.report({ lat, lon }, today));
  }

  async function handle(req: Req): Promise<Reply> {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
    const route = req.path.split("?")[0] ?? "";
    if (route === "/api/weather") {
      if (!authorised(req)) return json(401, { error: "unauthorised" });
      if (req.method !== "GET") return json(405, { error: "method not allowed" });
      return weather(req.path.split("?")[1] ?? "");
    }
    const feedMatch = /^\/calendar\/([A-Za-z0-9_-]+)\.ics$/.exec(route)?.[1];
    if (feedMatch !== undefined) return req.method === "GET" ? feed(feedMatch) : json(405, {});
    const tokenSpace = /^\/api\/spaces\/([^/]+)\/feed-token$/.exec(route)?.[1];
    if (tokenSpace !== undefined) {
      if (!validSpaceName(tokenSpace)) return json(404, { error: "not found" });
      if (!authorised(req)) return json(401, { error: "unauthorised" });
      if (req.method === "GET" || req.method === "POST") {
        return feedToken(tokenSpace, req.method === "POST");
      }
      return json(405, { error: "method not allowed" });
    }
    const space = /^\/api\/spaces\/([^/]+)$/.exec(route)?.[1];
    if (space !== undefined) {
      if (!validSpaceName(space)) return json(404, { error: "not found" });
      if (!authorised(req)) return json(401, { error: "unauthorised" });
      if (req.method === "GET") return getSpace(space);
      if (req.method === "PUT") return putSpace(space, req);
      return json(405, { error: "method not allowed" });
    }
    return json(404, { error: "not found" });
  }

  return { handle, files };
}
