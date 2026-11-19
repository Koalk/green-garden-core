// SPDX-License-Identifier: AGPL-3.0-only

/** Bridge settings from the environment (the repo's gitignored `.env` fills what the shell did not set). */
export interface BridgeSettings {
  readonly ok: true;
  readonly serverUrl: string;
  readonly token: string;
  readonly space: string;
  readonly syncSeconds: number;
  readonly mqtt: {
    readonly host: string;
    readonly port: number;
    readonly tls: boolean;
    readonly username?: string;
    readonly password?: string;
  };
}

export type SettingsResult = BridgeSettings | { readonly ok: false; readonly missing: string[] };

type Env = Readonly<Record<string, string | undefined>>;

export function bridgeSettings(env: Env): SettingsResult {
  const missing: string[] = [];
  const token = env["GREEN_GARDEN_SERVER_TOKEN"] ?? "";
  if (token === "") missing.push("GREEN_GARDEN_SERVER_TOKEN");
  const m = /^mqtt(s)?:\/\/([^:/\s]+)(?::(\d+))?\/?$/.exec(env["GREEN_GARDEN_HA_MQTT_URL"] ?? "");
  if (m?.[2] === undefined) missing.push("GREEN_GARDEN_HA_MQTT_URL");
  if (missing.length > 0 || m?.[2] === undefined) return { ok: false, missing };
  const tls = m[1] === "s";
  const username = env["GREEN_GARDEN_HA_MQTT_USER"] ?? "";
  const password = env["GREEN_GARDEN_HA_MQTT_PASSWORD"] ?? "";
  const seconds = Number(env["GREEN_GARDEN_HA_SYNC_SECONDS"] ?? 300);
  return {
    ok: true,
    serverUrl: env["GREEN_GARDEN_SERVER_URL"] || "http://localhost:8080",
    token,
    space: env["GREEN_GARDEN_HA_SPACE"] || "default",
    syncSeconds: Number.isFinite(seconds) && seconds >= 10 ? seconds : 300,
    mqtt: {
      host: m[2],
      port: m[3] === undefined ? (tls ? 8883 : 1883) : Number(m[3]),
      tls,
      ...(username === "" ? {} : { username, password }),
    },
  };
}
