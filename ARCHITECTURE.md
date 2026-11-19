# Architecture (stub)

Status: draft. The stack is TypeScript on a pnpm workspace (see
[ADR 0002](docs/adr/0002-stack.md)).

## Modules

```
engine/       pure logic: windows, combining, amounts, care status and outlook, calendar export. No I/O.
catalogue/    plant catalogue schema, validation, name matcher, bundled data
providers/    weather, rain-gauge and plant-ID interfaces and adapters; registry
storage/      repository interface and adapters (browser storage, file/JSON), export/import
server/       optional HTTP server exposing the same operations
client/       Backend interface and adapters: local (in-process) and remote (HTTP)
bulk/         bulk add flow, drafts and the improve-care-info view models, DOM-free
web-ui/       self-hosted web UI
ha-bridge/    Home Assistant bridge: reads sensors, exposes readings
vectors/      language-neutral golden test vectors (JSON), shared by all ports
```

Dependency rules (enforced by `scripts/check-boundaries.mjs`):

- `engine` depends on nothing, not even on the other modules.
- `catalogue`, `providers` and `storage` depend on `engine` types only.
- `bulk` depends on `catalogue`, `questions`, `storage` and `i18n` types; it takes the species list and a
  `Translate` as arguments.
- `web-ui` and `ha-bridge` depend on everything else; nothing depends on them.
- Adapters receive their HTTP client, clock and storage handle as parameters.

The web UI never calls the engine or storage directly. It calls a `Backend`: `LocalBackend` (engine and
storage in the same process) or `RemoteBackend` (the same calls over HTTP to `server/`). Both pass the
same contract tests.

## Concepts

- **Care engine:** pure logic. Plant requirements + location + weather + sun
  data in, care recommendations out. No I/O, no network, no storage.
- **Sun module:** photoperiod and daylight calculated locally from latitude,
  longitude and date. Weather APIs are used only for cloud cover and forecast.
- **Provider interfaces**, each swappable by configuration:
  - `WeatherProvider`: Open-Meteo first (no key). Stubs: OpenWeatherMap,
    Met Office, Visual Crossing, WeatherAPI, Home Assistant weather entity.
  - `PlantCatalogue`: OpenPlantbook adapter plus manual/user-defined plants.
  - `PlantIdentifier` (optional): bring-your-own-key. PlantNet, Plant.id.
- **Provider registry:** builds the configured providers from environment or
  config, so they can be swapped without code changes.
- **Delivery surfaces** (to be decided): app/web UI, optional server, Home
  Assistant integration.

## Principles

- The core never depends on the private app.
- Adapters take their HTTP client as a parameter so tests never hit the network.
- Local first; no cloud lock-in.

## Requirements any stack must meet

- Licence gate in CI: fail on GPL/AGPL/LGPL dependencies.
- SPDX header (`AGPL-3.0-only`) check on source files.
- Lint, format and test jobs.

## Name-dependent items

Name: Green Garden Core (`green-garden-core`). Keep it confined to: package
scope (set with the stack, ADR 0002), `GREEN_GARDEN_` env prefix, docs titles.
