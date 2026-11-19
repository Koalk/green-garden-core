// SPDX-License-Identifier: AGPL-3.0-only

import type { AppData, WeatherSettings } from "./model.ts";

/** Rounds the home point to 2 decimals and drops half a point or one out of range. */
export function weatherSettings(
  enabled: boolean,
  lat: number | undefined,
  lon: number | undefined,
): WeatherSettings {
  const ok = lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const r = (x: number): number => Math.round(x * 100) / 100;
  return { enabled, ...(ok ? { lat: r(lat), lon: r(lon) } : {}) };
}

/** Sets the weather switch and home point; switched off with no point stored, the setting goes away. */
export function setWeather(
  data: AppData,
  w: { readonly enabled: boolean; readonly lat?: number; readonly lon?: number },
): AppData {
  const rest = Object.fromEntries(Object.entries(data.settings).filter(([k]) => k !== "weather"));
  const next = weatherSettings(w.enabled, w.lat, w.lon);
  const keep = next.enabled || next.lat !== undefined;
  return {
    ...data,
    settings: { ...(rest as unknown as AppData["settings"]), ...(keep ? { weather: next } : {}) },
  };
}
