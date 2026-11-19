# Third-party licences and attribution

Keep this current. Add an entry before any dependency or data source is used.

## Code dependencies

Core dependencies must be MIT, Apache-2.0, BSD or ISC. M0 adds dev tooling only; the engine and every package have no runtime dependencies. `pnpm check:licences` fails on anything else in the installed tree (98 packages checked 2026-10-27).

| Package | Version | Licence | Used for |
| ------- | ------- | ------- | -------- |
| typescript | 6.0.3 | Apache-2.0 | Type checking (dev). Held below 6.1 for typescript-eslint's peer range |
| eslint | 10.13.0 | MIT | Lint (dev) |
| typescript-eslint | 8.72.0 | MIT | Lint rules for TypeScript (dev) |
| @picocss/pico | 2.1.1 | MIT | Stylesheet of the provisional web UI (`packages/web-ui`), self-hosted by the dev server |
| prettier | 3.9.10 | MIT | Format check (dev) |
| @types/node | 26.6.5 | MIT | Node typings for the vector runner and scripts (dev) |

The optional server and client add no dependencies: they use Node's built-in `http`, `net`, `tls`, `crypto` and `fs`, and the SMTP client is written in the repo (no mail library). The Home Assistant bridge adds none either: its MQTT 3.1.1 client is written in the repo (ADR 0003).

Tooling outside the repo (not dependencies): mise 2026.10.12 (MIT), Node 24.22.1 (MIT), pnpm 12.15.0 (MIT). Tests use Node's built-in `node:test`; vitest was tried and dropped because its `vite` dependency pulls in `lightningcss` (MPL-2.0), which the licence gate rejects.

## Data sources and APIs

Data licences are separate from code licences. "Unconfirmed" means the terms
have not been checked and the source must not be redistributed or used in a
paid product until they are.

| Source                                                  | Used for             | Key needed   | Data licence / terms                                                                                                                                                                                                           | Attribution                 | Status                                        |
| ------------------------------------------------------- | -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------- |
| Open-Meteo                                              | Weather              | No           | Check terms for commercial use                                                                                                                                                                                                 | Required; text TBC          | Unconfirmed                                   |
| OpenPlantbook                                           | Plant catalogue      | Yes          | Public statement (python-openplantbook README, checked 2026-10-26): "Anyone can use information from the database for any purpose without limitations." No formal data licence or terms published; image provenance not stated | TBC (credit Open Plantbook) | Statement found; written confirmation pending |
| PlantNet                                                | Plant identification | Yes (user's) | TBC                                                                                                                                                                                                                            | TBC                         | Unconfirmed                                   |
| Plant.id                                                | Plant identification | Yes (user's) | TBC                                                                                                                                                                                                                            | TBC                         | Unconfirmed                                   |
| OpenWeatherMap, Met Office, Visual Crossing, WeatherAPI | Weather              | Yes (user's) | TBC                                                                                                                                                                                                                            | TBC                         | Unconfirmed                                   |
