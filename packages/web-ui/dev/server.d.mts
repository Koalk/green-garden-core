// SPDX-License-Identifier: AGPL-3.0-only
export function handle(
  urlPath: string,
  ctx?: {
    weather?: { report(p: { lat: number; lon: number }, today: string): Promise<unknown> };
    now?: () => Date;
    env?: Record<string, string | undefined>;
    upstream?: (
      url: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body: string }>;
    haPost?: (
      url: string,
      init: { headers: Record<string, string>; body: string },
    ) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  },
): Promise<{ status: number; type: string; body: string }>;
export function loadEnv(text: string): Record<string, string>;
export function stopOnSignals(
  proc: { once(event: string, fn: () => void): unknown; exit(code: number): void },
  server: { close(done: () => void): unknown },
): void;
export function listenOptions(env: Record<string, string | undefined>): {
  host: string;
  port: number;
};
export function lanUrls(
  interfaces: Record<
    string,
    readonly { family: string; address: string; internal: boolean }[] | undefined
  >,
  port: number,
): string[];
