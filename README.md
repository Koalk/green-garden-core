# Green Garden Core

> **Status: pre-alpha.** Working name.

Open-source plant care engine and app. Given a plant and a location, it works
out light, water, temperature and humidity needs using local weather and
calculated sun hours.

## Principles

- **Bring your own keys.** Weather and optional photo-ID providers use keys
  you configure. Open-Meteo works without one.
- **Pluggable providers.** Weather, plant catalogue and plant ID each sit
  behind an interface, so sources can be swapped.
- **Local first.** Sun hours and photoperiod are calculated locally.
- **Home Assistant friendly.** A HACS integration is a planned target.

## Development

Needs [mise](https://mise.jdx.dev), which installs the pinned Node and pnpm.

```sh
mise install        # once: toolchain
mise run dev        # web UI on http://localhost:5173 and the home network
mise run check      # all CI gates
mise run layout-check # headless Chrome layout check of the web UI (needs Chrome or Edge; CHROME to point at one)
mise run preview-build # static preview of the web UI in dist/static (see below)
mise tasks          # list every task
```

## Static preview

`node scripts/build-static.mjs [outDir]` (or `mise run preview-build`) builds the web UI as plain files in
`dist/static`, with no server and no bundler: it strips the TypeScript types, renames `.ts` to `.js` and
makes every path relative, so any static host can serve it, also under a sub-path. Data stays in the
browser. A "Preview" label says so; everything that needs a server (rain from the server route, syncing,
email reminders, Home Assistant, OpenPlantbook search) is hidden. The calendar download (`.ics`) works.

On every push to `main`, once the check is green, the `preview` job in `.github/workflows/check.yml` builds
it and deploys it to GitHub Pages at `https://<owner>.github.io/<repo>/`. The repository owner has to turn
Pages on once (Settings > Pages > Source: GitHub Actions); until then the job reports a notice and
deploys nothing. `scripts/build-static.test.mjs` checks the build output (part of `pnpm check`); `mise run preview-check`
loads it in headless Chrome at 390 and 1440 px with no console errors and no request to a server route
(needs Chrome or Edge; `CHROME` points at one), and the `preview` job runs it before deploying.

## Self-hosting

The web UI runs fully in the browser by default and keeps its data in that browser. A small server is
optional: it keeps the data on your own machine, lets several devices share it, publishes a calendar
feed you can subscribe to, and can email you on watering days. It has no runtime dependencies (Node's
own `http`, `net`, `tls` and `crypto`).

```sh
# 1. In .env (copy .env.example): a long random token the server and your devices share
GREEN_GARDEN_SERVER_TOKEN=...
# 2. Start it (port 8080, reachable from the home network; HOST=127.0.0.1 keeps it local)
mise run server
```

Open the web UI, go to the Data tab, "Where your data lives", and enter the server address
(`http://<this machine's address>:8080`) and the token. If the server is empty your data is uploaded; if
it already has data you are asked before this browser's copy is replaced. Two devices cannot silently
overwrite each other: a save based on an old copy is refused (HTTP 409) and the UI says so.

- **Data:** one JSON file per space under `./data` (`GREEN_GARDEN_SERVER_DATA_DIR` to change), written
  atomically. The format is the same export/import JSON as the web UI.
- **Calendar feed:** `GET /api/spaces/default/feed-token` (bearer token) returns a secret; subscribe your
  calendar to `http://<server>:8080/calendar/<feed-token>.ics`. `POST` to the same path rotates it, which
  stops the old URL working. Anyone with the URL can read plant names and watering days, so treat it
  like a password.
- **Email reminders (optional):** one email on each watering day at a time you set (default 08:00),
  through your own SMTP account. The address, SMTP host and user, and the time live in the space's
  `settings.reminders` block (no secrets); the password is only read from `GREEN_GARDEN_SMTP_PASSWORD`.
  A plant stops being mentioned after 3 reminders nobody acted on; any log for it starts them again.
- **Not included:** accounts and logins (one shared token), TLS (put a reverse proxy in front if the
  server leaves your home network), web push.

## Licence

AGPL-3.0 (see `LICENSE`). Contributions need a signed CLA once the project
accepts outside pull requests (see `docs/licensing/`).

Plant data sources have their own licences. Do not copy datasets into this
repo; fetch them at runtime and record attribution per source.

## Documentation

- `ARCHITECTURE.md`: structure and concepts (modules and dependency rules)
- `CONTRIBUTING.md`: contribution rules and commit style
- `AGENTS.md`: context for AI coding assistants
- `THIRD_PARTY.md`: dependency and data-source licences
- `docs/adr/`: decision records
- `docs/licensing/`: the CLA
- `docs/data-format.md`: export/import format and version rule
- `docs/providers.md`: weather and rain providers, credits and limits

The stack is TypeScript on a pnpm workspace (ADR 0002).
