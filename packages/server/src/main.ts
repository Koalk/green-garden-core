// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entry point of the optional self-hosted server (`mise run server`). Config comes from the
 * environment, with the repo's gitignored `.env` filling in what the shell did not set:
 * GREEN_GARDEN_SERVER_TOKEN (required), GREEN_GARDEN_SERVER_DATA_DIR (default ./data), HOST, PORT, and GREEN_GARDEN_SMTP_PASSWORD for email
 * reminders (the rest of the SMTP settings live in the app's Settings, without secrets), and
 * GREEN_GARDEN_AEMET_KEY and GREEN_GARDEN_SEPA_KEY for the rain gauges in Spain and Scotland.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWeatherService, type Fetcher } from "@green-garden/providers";
import { createApp } from "./app.ts";
import { listenOptions, parseDotEnv } from "./env.ts";
import { createHttpServer } from "./http.ts";
import { startScheduler } from "./scheduler.ts";
import { makeSmtpTransport } from "./transport.ts";
import { fileCacheStore } from "./weather-store.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function dotEnv(): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(join(repo, ".env"), "utf8"));
  } catch {
    return {};
  }
}

const env = { ...dotEnv(), ...process.env };
const token = env["GREEN_GARDEN_SERVER_TOKEN"] ?? "";
if (token === "") {
  console.error("Set GREEN_GARDEN_SERVER_TOKEN (in .env or the environment) before starting.");
  process.exit(1);
}
const dir = resolve(env["GREEN_GARDEN_SERVER_DATA_DIR"] ?? "data");
const fetcher: Fetcher = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
const aemetKey = env["GREEN_GARDEN_AEMET_KEY"];
const sepaKey = env["GREEN_GARDEN_SEPA_KEY"];
const weather = buildWeatherService({
  fetcher,
  store: fileCacheStore(dir),
  now: () => new Date(),
  ...(aemetKey ? { aemetKey } : {}),
  ...(sepaKey ? { sepaKey } : {}),
  log: (line) => {
    console.log(line);
  },
});
const app = createApp({ dir, token, now: () => new Date(), weather });
const { host, port } = listenOptions(env);
const server = createHttpServer(app).listen(port, host, () => {
  console.log(`Green Garden server on http://${host}:${String(port)}/ (data in ${dir})`);
});
const stopScheduler = startScheduler(
  {
    files: app.files,
    password: env["GREEN_GARDEN_SMTP_PASSWORD"] ?? "",
    makeTransport: makeSmtpTransport,
  },
  (line) => {
    console.log(line);
  },
);
const stop = (): void => {
  stopScheduler();
  server.close(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
