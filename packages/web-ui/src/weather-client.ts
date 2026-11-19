// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The browser's side of the rain lookup: it asks its own server, as the Home Assistant
 * import does, and never a weather source. The server holds the keys, picks the gauge and caches an
 * hour. Only the home point, rounded to 2 decimals, and the local date travel, to the user's own server.
 */
import {
  roundPoint,
  type Fetcher,
  type GeoPoint,
  type WeatherReply,
} from "@green-garden/providers";
import type { SyncConfig } from "./sync.ts";

export type WeatherFailure = "unreachable" | "bad_response" | "unauthorised" | "not_configured";

export type WeatherResult =
  | { readonly ok: true; readonly reply: WeatherReply }
  | { readonly ok: false; readonly reason: WeatherFailure };

const NOTICE_CODES = ["aemet_no_key", "aemet_key_expiring", "aemet_key_expired"] as const;
const KINDS = ["measured", "modelled"] as const;

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** The server's answer, checked field by field; anything else is `undefined`. */
export function parseWeatherReply(raw: unknown): WeatherReply | undefined {
  const o = obj(raw);
  if (o === undefined) return undefined;
  const days = o["days"];
  const provenance = o["provenance"];
  const attributions = o["attributions"];
  if (!Array.isArray(days) || !Array.isArray(provenance) || !Array.isArray(attributions)) {
    return undefined;
  }
  const parsedDays: WeatherReply["days"][number][] = [];
  for (const d of days as unknown[]) {
    const x = obj(d);
    if (x === undefined || typeof x["date"] !== "string" || typeof x["rainMm"] !== "number") {
      return undefined;
    }
    const kind = KINDS.find((k) => k === x["kind"]);
    parsedDays.push({
      date: x["date"],
      rainMm: x["rainMm"],
      ...(kind === undefined ? {} : { kind }),
      ...(x["forecast"] === true ? { forecast: true } : {}),
    });
  }
  const parsedProv: WeatherReply["provenance"][number][] = [];
  for (const p of provenance as unknown[]) {
    const x = obj(p);
    const kind = KINDS.find((k) => k === x?.["kind"]);
    if (x === undefined || typeof x["day"] !== "string" || kind === undefined) return undefined;
    parsedProv.push(x as unknown as WeatherReply["provenance"][number]);
  }
  const notices: WeatherReply["notices"][number][] = [];
  for (const n of Array.isArray(o["notices"]) ? (o["notices"] as unknown[]) : []) {
    const x = obj(n);
    const code = NOTICE_CODES.find((c) => c === x?.["code"]);
    if (code === undefined) continue;
    notices.push(
      typeof x?.["daysLeft"] === "number" ? { code, daysLeft: x["daysLeft"] } : { code },
    );
  }
  return {
    days: parsedDays,
    provenance: parsedProv,
    attributions: (attributions as unknown[]).filter((a): a is string => typeof a === "string"),
    notices,
    fetchedAt: typeof o["fetchedAt"] === "string" ? o["fetchedAt"] : "",
    ...(o["stale"] === true ? { stale: true as const } : {}),
  };
}

/**
 * Asks for the rain around `point` on the local date `today`. With a server chosen under Data the
 * request goes there with its token; without one it goes to the page's own origin (the dev server).
 */
export async function loadWeather(
  fetcher: Fetcher,
  server: SyncConfig | undefined,
  point: GeoPoint,
  today: string,
): Promise<WeatherResult> {
  const p = roundPoint(point);
  const base = server === undefined ? "" : server.url.replace(/\/+$/, "");
  const url = `${base}/api/weather?lat=${String(p.lat)}&lon=${String(p.lon)}&today=${today}`;
  try {
    const res = await fetcher(
      url,
      server === undefined ? undefined : { headers: { authorization: `Bearer ${server.token}` } },
    );
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorised" };
    if (res.status === 503) return { ok: false, reason: "not_configured" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const reply = parseWeatherReply(await res.json());
    return reply === undefined ? { ok: false, reason: "bad_response" } : { ok: true, reply };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
