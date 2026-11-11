// SPDX-License-Identifier: AGPL-3.0-only
// Live smoke test for the rain sources: runs each enabled adapter once against the real service
// and prints what came back. Not part of `mise run check` (the tests never call out). Run: mise run weather-smoke
// Optional: GREEN_GARDEN_SMOKE_LAT and GREEN_GARDEN_SMOKE_LON (default: central London, inside the
// Environment Agency's area). GREEN_GARDEN_SMOKE_GAUGE picks the gauge: environment-agency (default),
// aemet (needs GREEN_GARDEN_AEMET_KEY; try 40.42, -3.70) or sepa (key optional; try 55.95, -3.19).
// Keys are read from the environment or `.env`. Nothing is stored or printed beyond rain figures and station ids.
import { existsSync, readFileSync } from "node:fs";
import {
  Aemet,
  EnvironmentAgency,
  OpenMeteo,
  Sepa,
  rainReport,
} from "../packages/providers/src/index.ts";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined && m[2] !== "") process.env[m[1]] = m[2];
  }
}

const point = {
  lat: Number(process.env.GREEN_GARDEN_SMOKE_LAT ?? 51.5),
  lon: Number(process.env.GREEN_GARDEN_SMOKE_LON ?? -0.12),
};
const fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
const nowIso = new Date().toISOString();
const today = nowIso.slice(0, 10);

const which = process.env.GREEN_GARDEN_SMOKE_GAUGE ?? "environment-agency";
let gauge;
if (which === "aemet") {
  if (!process.env.GREEN_GARDEN_AEMET_KEY) {
    console.error(
      "AEMET is off: GREEN_GARDEN_AEMET_KEY is not set (free key: opendata.aemet.es). Not run.",
    );
    process.exit(2);
  }
  gauge = new Aemet(fetcher, process.env.GREEN_GARDEN_AEMET_KEY);
} else if (which === "sepa") {
  gauge = new Sepa(fetcher, process.env.GREEN_GARDEN_SEPA_KEY);
  if (!process.env.GREEN_GARDEN_SEPA_KEY)
    console.log("SEPA: no key set, using the keyless daily limit");
} else {
  gauge = new EnvironmentAgency(fetcher);
}

const report = await rainReport({ weather: new OpenMeteo(fetcher), gauge }, point, today, nowIso);
if (report.days.length === 0) {
  console.error("no rain days came back: both sources failed or are unreachable");
  process.exit(1);
}
for (const [i, d] of report.days.entries()) {
  const p = report.provenance[i];
  console.log(
    `${d.date}  ${String(d.rainMm).padStart(5)} mm  ${d.kind ?? "measured"}${d.forecast === true ? " (forecast)" : ""}` +
      (p?.stationId === undefined ? "" : `  station ${p.stationId}, ${String(p.distanceKm)} km`),
  );
}
console.log("credits:", report.attributions.join(" | "));
const measured = report.days.filter((d) => d.kind === "measured").length;
console.log(
  `${String(measured)} measured day(s), ${String(report.days.length - measured)} modelled or forecast`,
);
