// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rain service the servers run: picks the gauge for a home point, fetches through
 * `rainReport`, keeps each answer for an hour in the server's own store (never the browser's), and adds
 * notices such as an AEMET key that is missing, about to lapse or expired. It holds the API keys; nothing
 * it returns carries one. The browser asks it with a rounded point and never talks to a source itself.
 */
import type { WeatherDay } from "@green-garden/engine";
import { Aemet } from "./aemet.ts";
import { EnvironmentAgency } from "./environment-agency.ts";
import type { Fetcher } from "./http.ts";
import { OpenMeteo } from "./open-meteo.ts";
import { rainReport } from "./rain.ts";
import { Sepa } from "./sepa.ts";
import {
  roundPoint,
  type GaugeProvider,
  type GeoPoint,
  type Provenance,
  type WeatherProvider,
} from "./weather.ts";

export type GaugeId = "environment-agency" | "aemet" | "sepa";

/** One blob in the server's store; the service owns its shape. */
export interface CacheStore {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export interface WeatherNotice {
  readonly code: "aemet_no_key" | "aemet_key_expiring" | "aemet_key_expired";
  readonly daysLeft?: number;
}

export interface WeatherReply {
  readonly days: readonly WeatherDay[];
  readonly provenance: readonly Provenance[];
  readonly attributions: readonly string[];
  readonly notices: readonly WeatherNotice[];
  /** When the sources were last asked, ISO 8601. */
  readonly fetchedAt: string;
  /** The sources failed and this is the last good answer. */
  readonly stale?: true;
}

export interface WeatherServiceOptions {
  readonly weather: WeatherProvider;
  readonly gauges: Partial<Record<string, GaugeProvider>>;
  readonly store: CacheStore;
  readonly now: () => Date;
  /** The AEMET key (a JWT), only used to read its expiry. */
  readonly aemetKey?: string;
  readonly log?: (line: string) => void;
}

const HOUR_MS = 3_600_000;
const KEEP_MS = 24 * HOUR_MS;
const MAX_ENTRIES = 40;
const WARN_DAYS = 21;

/** Which gauges cover a point, best first; none when no gauge does (the model alone then). */
export function candidateGauges(p: GeoPoint): GaugeId[] {
  const inBox = (lat0: number, lat1: number, lon0: number, lon1: number): boolean =>
    p.lat >= lat0 && p.lat <= lat1 && p.lon >= lon0 && p.lon <= lon1;
  if (inBox(27.4, 44.0, -19, 5)) return ["aemet"];
  if (!inBox(49.8, 61, -9, 2)) return [];
  if (p.lat >= 55.8) return ["sepa"];
  if (p.lat >= 54.9) {
    return p.lon < -2.5 ? ["sepa", "environment-agency"] : ["environment-agency", "sepa"];
  }
  return ["environment-agency"];
}

export interface AemetKeyStatus {
  readonly state: "missing" | "unreadable" | "valid" | "expiring" | "expired";
  readonly daysLeft?: number;
  /** ISO 8601, when the key lapses. */
  readonly expiresAt?: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Text (ASCII is all a JWT claim set needs) from base64url, with no platform API (this package runs in the browser too). Throws on bad input. */
function decodeBase64Url(input: string): string {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of input.replace(/=+$/, "")) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("not base64url");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return String.fromCharCode(...bytes);
}

/** Reads the `exp` claim of the key (a JWT) without checking its signature; no network, no model. */
export function aemetKeyStatus(key: string | undefined, nowMs: number): AemetKeyStatus {
  if (key === undefined || key.trim() === "") return { state: "missing" };
  try {
    const part = key.trim().split(".")[1];
    if (part === undefined) return { state: "unreadable" };
    const claims: unknown = JSON.parse(decodeBase64Url(part));
    const exp = (claims as { exp?: unknown } | null)?.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return { state: "unreadable" };
    const left = exp * 1000 - nowMs;
    const expiresAt = new Date(exp * 1000).toISOString();
    if (left <= 0) return { state: "expired", expiresAt };
    const daysLeft = Math.floor(left / 86_400_000);
    return { state: left < WARN_DAYS * 86_400_000 ? "expiring" : "valid", daysLeft, expiresAt };
  } catch {
    return { state: "unreadable" };
  }
}

type Core = Omit<WeatherReply, "notices" | "stale">;
interface Entry {
  readonly at: number;
  readonly report: Core;
}

function isEntry(v: unknown): v is Entry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  const r = e["report"];
  return (
    typeof e["at"] === "number" &&
    typeof r === "object" &&
    r !== null &&
    Array.isArray((r as Record<string, unknown>)["days"])
  );
}

export class WeatherService {
  private readonly o: WeatherServiceOptions;
  private readonly inflight = new Map<string, Promise<Core>>();
  constructor(options: WeatherServiceOptions) {
    this.o = options;
  }

  private async entries(): Promise<Record<string, Entry>> {
    const raw = await this.o.store.load().catch(() => undefined);
    const e = (raw as { entries?: unknown } | null | undefined)?.entries;
    if (typeof e !== "object" || e === null) return {};
    const out: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(e)) if (isEntry(v)) out[k] = v;
    return out;
  }

  private notices(point: GeoPoint): { list: WeatherNotice[]; skipAemet: boolean } {
    if (!candidateGauges(point).includes("aemet")) return { list: [], skipAemet: false };
    const k = aemetKeyStatus(this.o.aemetKey, this.o.now().getTime());
    if (k.state === "missing") return { list: [{ code: "aemet_no_key" }], skipAemet: true };
    if (k.state === "expired") {
      this.o.log?.("AEMET key expired, renew it at opendata.aemet.es");
      return { list: [{ code: "aemet_key_expired" }], skipAemet: true };
    }
    if (k.state === "expiring" && k.daysLeft !== undefined) {
      this.o.log?.(
        `AEMET key expires in ${String(k.daysLeft)} days, renew it at opendata.aemet.es`,
      );
      return { list: [{ code: "aemet_key_expiring", daysLeft: k.daysLeft }], skipAemet: false };
    }
    return { list: [], skipAemet: false };
  }

  /** The rain for a home point (rounded here to 2 decimals) and the local date `today`. */
  async report(raw: GeoPoint, today: string): Promise<WeatherReply> {
    const point = roundPoint(raw);
    const { list, skipAemet } = this.notices(point);
    const key = `${String(point.lat)},${String(point.lon)},${today},${skipAemet ? "n" : "a"}`;
    const nowMs = this.o.now().getTime();
    const cached = (await this.entries())[key];
    if (cached !== undefined && nowMs - cached.at < HOUR_MS && nowMs >= cached.at) {
      return { ...cached.report, notices: list };
    }
    let pending = this.inflight.get(key);
    if (pending === undefined) {
      pending = this.fetch(point, today, skipAemet);
      this.inflight.set(key, pending);
    }
    let core: Core;
    try {
      core = await pending;
    } finally {
      this.inflight.delete(key);
    }
    if (core.days.length > 0) {
      await this.remember(key, { at: nowMs, report: core });
      return { ...core, notices: list };
    }
    if (cached !== undefined) return { ...cached.report, notices: list, stale: true };
    return { ...core, notices: list };
  }

  private async remember(key: string, entry: Entry): Promise<void> {
    const now = this.o.now().getTime();
    const all = { ...(await this.entries()), [key]: entry };
    const kept = Object.entries(all)
      .filter(([, e]) => now - e.at < KEEP_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    await this.o.store.save({ entries: Object.fromEntries(kept) }).catch(() => undefined);
  }

  private async fetch(point: GeoPoint, today: string, skipAemet: boolean): Promise<Core> {
    const nowIso = this.o.now().toISOString();
    const ids = candidateGauges(point).filter((id) => !(skipAemet && id === "aemet"));
    let best: Awaited<ReturnType<typeof rainReport>> | undefined;
    for (const id of ids) {
      const gauge = this.o.gauges[id];
      if (gauge === undefined) continue;
      const r = await rainReport({ weather: this.o.weather, gauge }, point, today, nowIso);
      best ??= r;
      if (r.provenance.some((p) => p.kind === "measured")) {
        best = r;
        break;
      }
    }
    best ??= await rainReport({ weather: this.o.weather }, point, today, nowIso);
    return {
      days: best.days,
      provenance: best.provenance,
      attributions: best.attributions,
      fetchedAt: nowIso,
    };
  }
}

/** The real sources, wired to a `fetch`-shaped function and the keys the server holds. */
export function buildWeatherService(options: {
  readonly fetcher: Fetcher;
  readonly store: CacheStore;
  readonly now: () => Date;
  readonly aemetKey?: string;
  readonly sepaKey?: string;
  readonly log?: (line: string) => void;
}): WeatherService {
  const { fetcher } = options;
  return new WeatherService({
    weather: new OpenMeteo(fetcher, () => options.now().toISOString()),
    gauges: {
      "environment-agency": new EnvironmentAgency(fetcher),
      aemet: new Aemet(fetcher, options.aemetKey),
      sepa: new Sepa(fetcher, options.sepaKey, () => options.now().getTime()),
    },
    store: options.store,
    now: options.now,
    ...(options.aemetKey === undefined ? {} : { aemetKey: options.aemetKey }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
}
