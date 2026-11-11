// SPDX-License-Identifier: AGPL-3.0-only

/** KEY=value lines (comments, blanks and surrounding quotes handled), for the gitignored .env. */
export function parseDotEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m?.[1] === undefined) continue;
    out[m[1]] = (m[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Host and port from the environment: all interfaces on 8080 unless HOST or PORT say otherwise. */
export function listenOptions(env: Readonly<Record<string, string | undefined>>): {
  host: string;
  port: number;
} {
  return { host: env["HOST"] ?? "0.0.0.0", port: Number(env["PORT"] ?? 8080) };
}
