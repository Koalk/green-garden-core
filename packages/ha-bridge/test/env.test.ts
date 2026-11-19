// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeSettings } from "../src/index.ts";

describe("bridge settings from the environment", () => {
  it("needs the server token and the MQTT broker", () => {
    assert.deepEqual(bridgeSettings({}), {
      ok: false,
      missing: ["GREEN_GARDEN_SERVER_TOKEN", "GREEN_GARDEN_HA_MQTT_URL"],
    });
  });

  it("fills in defaults", () => {
    const r = bridgeSettings({
      GREEN_GARDEN_SERVER_TOKEN: "t",
      GREEN_GARDEN_HA_MQTT_URL: "mqtt://192.168.1.5",
    });
    assert.deepEqual(r, {
      ok: true,
      serverUrl: "http://localhost:8080",
      token: "t",
      space: "default",
      syncSeconds: 300,
      mqtt: { host: "192.168.1.5", port: 1883, tls: false },
    });
  });

  it("reads port, TLS, credentials, space and interval", () => {
    const r = bridgeSettings({
      GREEN_GARDEN_SERVER_TOKEN: "t",
      GREEN_GARDEN_SERVER_URL: "http://localhost:9090",
      GREEN_GARDEN_HA_MQTT_URL: "mqtts://broker.lan:8883",
      GREEN_GARDEN_HA_MQTT_USER: "u",
      GREEN_GARDEN_HA_MQTT_PASSWORD: "p",
      GREEN_GARDEN_HA_SPACE: "office",
      GREEN_GARDEN_HA_SYNC_SECONDS: "60",
    });
    assert.deepEqual(r, {
      ok: true,
      serverUrl: "http://localhost:9090",
      token: "t",
      space: "office",
      syncSeconds: 60,
      mqtt: { host: "broker.lan", port: 8883, tls: true, username: "u", password: "p" },
    });
  });

  it("rejects a broker address that is not an mqtt URL", () => {
    const r = bridgeSettings({
      GREEN_GARDEN_SERVER_TOKEN: "t",
      GREEN_GARDEN_HA_MQTT_URL: "ftp://x",
    });
    assert.deepEqual(r, { ok: false, missing: ["GREEN_GARDEN_HA_MQTT_URL"] });
  });
});
