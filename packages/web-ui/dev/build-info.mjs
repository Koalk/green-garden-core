// SPDX-License-Identifier: AGPL-3.0-only
// The build's identity: the short commit and today's date, as the script tag the page loads first.
// Without git the commit is "dev", so a build never fails for it.
import { execFileSync } from "node:child_process";

/** The short commit of the checkout this file is in, or "dev". */
export function shortCommit() {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{4,40}$/.test(out) ? out : "dev";
  } catch {
    return "dev";
  }
}

/** `<script>` text that sets `globalThis.__GG_BUILD__` for the web UI. */
export function buildScript(now = new Date()) {
  const info = { commit: shortCommit(), date: now.toISOString().slice(0, 10) };
  return `<script>globalThis.__GG_BUILD__ = ${JSON.stringify(info)};</script>`;
}
