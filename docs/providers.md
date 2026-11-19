<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Providers

`packages/providers` holds the adapters for outside data. Each source sits behind an interface, the
HTTP client is injected, and tests use recorded fixtures (`packages/providers/test/fixtures/`) so they
never call the network or need a key. Keys come from `.env` (see `.env.example`) and stay on the
server.

## Rain and weather

```ts
rainReport({ weather: new OpenMeteo(fetcher), gauge?: new EnvironmentAgency(fetcher) }, point, today, nowIso)
//   -> { days: WeatherDay[], provenance: Provenance[], attributions: string[] }
```

`WeatherDay` carries `kind?: "measured" | "modelled"`. For each day the engine takes a logged "It
rained" first, then a measured row, then a modelled row. Forecast rows never credit. The plan is a
pure function of what it is given, so a later gauge value replaces an earlier estimate the next time
the plan is built. The core storage keeps no weather.

| | Open-Meteo | Environment Agency | AEMET | SEPA |
|---|---|---|---|---|
| Kind | model (forecast API, `past_days`) | gauge, England | gauge, Spain and islands | gauge, Scotland |
| Key | none | none | required (`GREEN_GARDEN_AEMET_KEY`); unset means nothing is called | optional (`GREEN_GARDEN_SEPA_KEY`); keyless use has a standard daily limit |
| Day boundary | civil day (`timezone=auto`) | UTC day | UTC day | 09:00 to 09:00 GMT; a row is stamped at the start of its day |
| Quality | unknown | raw | raw | raw |
| Licence | CC BY 4.0; the free API is non-commercial only | OGL 3.0 | AEMET reuse terms (Ley 18/2015) | OGL 3.0 per SEPA's data table; older terms say non-commercial |

### Credit lines (shown in the app's "Data sources" block)

- Open-Meteo: "Weather data by Open-Meteo.com"
- Environment Agency: "This uses Environment Agency rainfall data from the real-time data API (Beta)"
- AEMET: "© AEMET"
- SEPA: "Contains SEPA data © Scottish Environment Protection Agency and database right 2026. All rights reserved"

`RAIN_SOURCES` records `commercialUse` per source: Open-Meteo `no` (free tier), Environment Agency
and AEMET `confirmed`, SEPA `pending`.

### Selection and combining (`packages/providers/src/rain.ts`)

- Gauges within `GAUGE_RADIUS_KM` (10) are considered; readings are fetched for the nearest 5 and at
  most `MAX_STATIONS` (3) count per day, combined by a median weighted by 1 / (km + 1).
- A day counts only when it has ended and a station has all of its quarter-hour readings; otherwise
  that station is unknown for the day. A day no station covers falls back to the modelled value. A
  missing interval is never read as zero.
- `PAST_DAYS` is 7 and `FORECAST_DAYS` is 3. Points are rounded to 2 decimals (about 1 km) before any
  request. These numbers are provisional.
- `WeatherService` (`weather-service.ts`) chooses gauges by rough region boxes, tries the next
  candidate when one has no measured days, caches answers for an hour per rounded point and date, and
  serves the last answer marked `stale` when sources fail. It never caches an empty answer.
- `aemetKeyStatus` decodes the key's expiry (no network, signature not checked) and gives notices:
  no key, expiring within 21 days, expired (AEMET is then not called).

### Server route

The self-hosted server answers `GET /api/weather?lat&lon&today` (bearer token; 503 if not set up; 400
for a bad point or a date more than 3 days from now) and keeps its cache in `<data dir>/cache/weather.json`.
The dev server serves the same route without a token and caches in memory.

### Known limits

- AEMET daily values lag about three days, so the model fills the last days.
- AEMET's data endpoint answers in ISO-8859-15; accented station names can come out with a
  replacement character (labels only).
- Gauge region boxes are rough; Northern Ireland and the Isle of Man get the Environment Agency,
  find no stations and use the model.

### Live smoke test

`mise run weather-smoke` (`scripts/weather-smoke.mjs`) runs Open-Meteo and one gauge, chosen by
`GREEN_GARDEN_SMOKE_GAUGE` (`environment-agency` by default, `aemet` or `sepa`). It reads keys from the
environment or `.env`.
