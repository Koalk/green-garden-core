// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entry point of the Home Assistant bridge (`mise run ha-bridge`): reads the core server, publishes the
 * plants to HA over MQTT discovery and listens for the "watered" and "still wet" buttons. See
 * docs/home-assistant.md for the settings; they come from the environment, with the repo's gitignored
 * `.env` filling in what the shell did not set.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RemoteBackend, type FetchFn } from "@green-garden/client";
import { parseDotEnv } from "@green-garden/server";
import { Bridge } from "./bridge.ts";
import { bridgeSettings } from "./env.ts";
import { statusTopic } from "./entities.ts";
import { MqttTransport } from "./mqtt.ts";
import { openMqttSocket } from "./mqtt-socket.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function dotEnv(): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(join(repo, ".env"), "utf8"));
  } catch {
    return {};
  }
}

const settings = bridgeSettings({ ...dotEnv(), ...process.env });
if (!settings.ok) {
  console.error(`Set ${settings.missing.join(", ")} (in .env or the environment) before starting.`);
  process.exit(1);
}

const fetchFn: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, text: () => res.text() };
};
const space = settings.space;
const transport = new MqttTransport({
  open: () => openMqttSocket(settings.mqtt.host, settings.mqtt.port, settings.mqtt.tls),
  clientId: `green-garden-${space}`,
  will: { topic: statusTopic(space), payload: "offline", retain: true },
  ...(settings.mqtt.username === undefined
    ? {}
    : { username: settings.mqtt.username, password: settings.mqtt.password }),
});
const log = (line: string): void => {
  console.log(`${new Date().toISOString()} ${line}`);
};
const bridge = new Bridge({
  backend: new RemoteBackend({ url: settings.serverUrl, token: settings.token, space, fetchFn }),
  transport,
  config: { space, discoveryPrefix: "homeassistant" },
  now: () => new Date(),
  log,
});

await bridge.start();
log(`Green Garden HA bridge up (server ${settings.serverUrl}, space ${space})`);
// Edits made in the app, a new day and a restarted HA all show up on the next sync.
const timer = setInterval(() => {
  bridge.sync().catch((e: unknown) => {
    log(`sync failed: ${String(e)}`);
  });
}, settings.syncSeconds * 1000);
const stop = (): void => {
  clearInterval(timer);
  bridge
    .stop()
    .then(() => transport.close())
    .catch(() => undefined)
    .finally(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
