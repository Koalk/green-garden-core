# ADR 0002: Technology stack

- Status: Accepted 2026-10-27
- Date: 2026-10-25
- Options analysis and recommendation: AI-drafted. Language, layout, HA path,
  publishing and toolchain accepted by the maintainer.

## Context

No stack is chosen. Goals so far:

- One source for web, Android and iOS if practical.
- A pure, I/O-free care engine that can run on-device, so a server is optional.
- A Home Assistant integration is a target and is usually Python. A
  client-side engine in another language needs a port, a thin service, or a
  shared spec with test vectors.

## Decision (language and packaging parts)

Mobile shell, ads, billing and sync are not part of this ADR's closed scope.

1. **Engine language: TypeScript.** Pure, zero runtime dependencies, dates as
   ISO `YYYY-MM-DD` strings. One language for engine, web UI and server.
2. **Layout: pnpm workspace, one package per module** (`engine`, `catalogue`,
   `providers`, `storage`, `client`, `server`, `web-ui`, `ha-bridge`) with
   `vectors/` at the root. The import rules (see the module list in
   [ARCHITECTURE.md](../../ARCHITECTURE.md)) are lint-enforced; `engine` imports nothing.
3. **Home Assistant:** the bridge reads HA sensors and feeds readings to the
   core server. No Python engine. A Python port is considered only if a later
   HA integration needs engine logic inside HA, and then it is held to the
   shared golden vectors, which stay language-neutral from day one.
4. **Publishing:** private workspace for now, placeholder scope
   `@green-garden/*`, all packages `"private": true`. Publishing to a
   registry is revisited once the name is settled.
5. **Toolchain:** `mise.toml` pins Node and pnpm; `packageManager` in
   `package.json` pins pnpm for contributors without mise.

Status of this ADR: language, layout, HA path and publishing are agreed by the
maintainer; M0 confirmed the toolchain (below) and the ADR is Accepted.

## To confirm at M0
Result on a Windows 11 machine:

- **mise on Windows: works.** Installed with `winget install jdx.mise` (2026.10.12).
  `mise trust` then `mise install` fetched Node 24.22.1 (current LTS) and pnpm
  12.15.0 from `mise.toml` in about 4 seconds. `mise exec -- pnpm ...` works
  from Git Bash and from PowerShell.
- **Caveat:** winget changes PATH, so shells opened before the install do not
  see `mise` until restarted. Without `mise activate` in the shell profile,
  `node`/`pnpm` resolve to the system ones (system Node is 25, not LTS, and
  pnpm is absent); use `mise exec -- <cmd>` or add activation to the profile.
  Not tested: a clean checkout on Linux/macOS (CI uses `jdx/mise-action`,
  untested until a remote exists).
- **Project-local pnpm store:** `store-dir=.pnpm-store` in `.npmrc` works
  (gitignored).
- **Licence check:** all 5 dev dependencies are MIT or Apache-2.0
  (`THIRD_PARTY.md`); the installed tree of 98 packages passes the licence gate.
  vitest was rejected: it pulls `lightningcss` (MPL-2.0). Tests use the built-in
  `node:test` with Node's type stripping (`erasableSyntaxOnly`, `.ts` import
  extensions). Revisit if property tests need more than `node:test` offers.
- **TypeScript is held at 6.0.x** because typescript-eslint 8.72 declares
  support for `<6.1.0`; TypeScript 7 is out.
- Android tooling (Java, SDK) belongs to the app phase and is out of scope here.

Status: the toolchain items are confirmed and the ADR is accepted.

## Requirements any choice must satisfy

- Engine testable without network or keys.
- Provider interfaces swappable by configuration.
- CI: lint, test, dependency-licence gate (permissive only), SPDX header check.
- Every dependency licence checked before adding.

## Options analysis

### A. Engine language

|                                       | TypeScript                                                                            | Python                                                | Rust compiled to WASM (and native)                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Runs in browser / on phone            | Directly (any JS runtime, React Native, WebView)                                      | Poorly: needs Pyodide (large, slow start) or a server | Yes via WASM; native bindings are extra work per platform                                                |
| Home Assistant (Python)               | Needs a port, a service, or shared vectors                                            | Native: the engine is the integration                 | Python bindings possible (PyO3), but HA custom components with compiled wheels are awkward to distribute |
| Solo spare-time cost                  | Low: one language for engine, web test UI and app                                     | Low for engine, high for UI/mobile (second language)  | Highest: new toolchain, FFI glue, slower iteration                                                       |
| Pure-logic fit                        | Good; date arithmetic needs care (use plain ISO dates, avoid timezone-bearing `Date`) | Good (`datetime.date` is clean)                       | Excellent                                                                                                |
| Contributor pool for an OSS plant app | Large                                                                                 | Large, and HA users already read Python               | Small                                                                                                    |
| Test vectors                          | JSON in, JSON out, any runner                                                         | same                                                  | same                                                                                                     |

The engine is small (interval-stabbing plus rules). Raw performance is
irrelevant; reach and maintenance are what matter. That removes most of Rust's
advantage and keeps the question between TypeScript and Python.

### B. How the engine reaches Home Assistant

1. **Port:** write the engine in both languages, kept honest by shared golden
   test vectors (JSON fixtures: input state, expected plan). Two small
   implementations, one spec. The cost is a second implementation to maintain,
   mitigated by the vectors catching divergence.
2. **Service:** run the one engine as a small server; HA integration/bridge
   calls it over HTTP. No duplicate logic, but HA users must run another
   container/add-on, and the bridge becomes mandatory.
3. **Shared vectors only (no HA engine):** HA integration only reads sensors
   and talks to a core server (or the bridge). No
   Python engine needed.
4. **Python engine, TypeScript port for the app:** same as option 1 with the
   roles reversed.

### C. Repository layout and publishing

- **Monorepo with packages** (for example `engine`, `catalogue`, `providers`,
  `web-ui`, `ha-bridge`), workspaces managed by one tool (pnpm workspaces for
  TypeScript). One CI, one version, easy atomic changes. Consumers import the
  packages. This fits a solo maintainer.
- **Single package:** simplest, but the web UI and bridge would pull in
  dependencies the engine should not have.
- **Publishing:** the packages may be published to a registry later, or consumed
  by downstream projects from a local path/git reference . Package scope depends on the final name and
  trademark check.
- The engine package has zero runtime dependencies (purity rule), so the
  licence gate stays trivial for it.

## Recommendation (AI-drafted)

1. **Engine in TypeScript**, pure, zero runtime dependencies, dates as ISO
   `YYYY-MM-DD` strings. Reason: one language across engine, test UI and any app
   shell, directly importable on web and mobile.
2. **Home Assistant: option 3 first, option 1 if needed.** The bridge only reads HA sensors and feeds readings to the engine side, so no
   Python engine is needed at first. If a HACS integration later needs engine
   logic in HA, port it to Python and hold both to the **shared golden test
   vectors** (see the `vectors/` package). Make the vectors
   language-neutral from day one, which costs almost nothing.
3. **Monorepo with workspaces**, engine package published (when allowed)
   separately from the web UI.
4. **Revisit** if the first prototype shows date/timezone bugs that Python would
   avoid, or if the integration must live inside HA.

Alternatives I would pick in other circumstances: Python engine if the primary
audience turns out to be Home Assistant users running the web UI server-side.
Rust/WASM only if a second consumer language appears that needs identical
native performance, which is unlikely.

## Maintainer input

The maintainer accepts TypeScript for the engine. The core ships a web UI that is
also the self-hosted UI, plus an optional modular server, with a client
backend that can run fully local. This is input, not a decision: the ADR stays
Proposed until the packaging session closes it.

## Open questions

None for language and packaging. HA integration is a stretch goal and two
implementations are avoided for now (see Decision, item 3).

## Consequences if the recommendation is accepted

- Node toolchain and a workspace tool become the first dependencies (licence
  check and `THIRD_PARTY.md` update at that point).
- The Python port, if ever needed, is justified by the vectors rather than by
  copying code.
- Mobile shell choice stays free of this ADR, except that a non-JS shell
  (Flutter) would need the port or WASM route.
