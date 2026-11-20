// SPDX-License-Identifier: AGPL-3.0-only
// Shared headless Chrome start for static-check, layout-check and dark-check. Chrome is started with
// --remote-debugging-port=0 (it picks a free port itself, so no guessing and no clashes) and the port
// is read from DevToolsActivePort in the profile folder. On failure the error says why: the wait, Chrome's
// exit code and the last lines of its stderr.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const START_TIMEOUT_MS = 30000;

// The first line of DevToolsActivePort is the port. Undefined while the file is missing or not yet complete.
export function readDevToolsPort(profileDir) {
  const file = join(profileDir, "DevToolsActivePort");
  if (!existsSync(file)) return undefined;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split("\n");
  // Chrome writes the port line, then the browser path; wait for the newline so a half-written number is never read.
  if (lines.length < 2 || !/^\d+$/.test(lines[0])) return undefined;
  return Number(lines[0]);
}

export async function waitForPort(
  profileDir,
  { timeoutMs = START_TIMEOUT_MS, pollMs = 100, exited = () => false } = {},
) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const port = readDevToolsPort(profileDir);
    if (port !== undefined) return port;
    if (exited() || Date.now() >= end) return undefined;
    await sleep(pollMs);
  }
}

export function failureMessage({ timeoutMs, exitCode, stderr }) {
  const tail = stderr.trim().split("\n").filter(Boolean).slice(-10).join("\n");
  return [
    `Chrome did not open a page within ${Math.round(timeoutMs / 1000)} s`,
    exitCode === null ? "Chrome was still running (no exit code)" : `Chrome exit code ${exitCode}`,
    tail === "" ? "no stderr from Chrome" : `last stderr lines:\n${tail}`,
  ].join("; ");
}

// Flags: --headless=new and --no-first-run for every caller. On a CI Linux runner (CI or GITHUB_ACTIONS set)
// also --no-sandbox (the runner's user namespaces and container reject Chrome's sandbox) and
// --disable-dev-shm-usage (a small /dev/shm crashes tabs); not added on a developer machine, where the sandbox stays on.
export function chromeArgs({
  profile,
  extra = [],
  env = process.env,
  platform = process.platform,
}) {
  const ci = platform === "linux" && (env.CI === "true" || env.GITHUB_ACTIONS === "true");
  return [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    ...(ci ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    ...extra,
    "about:blank",
  ];
}

// Starts Chrome and resolves with { proc, profile, wsUrl, stop }. Throws the readable error if it never opens a page.
export async function startChrome(
  chrome,
  { prefix = "gg-chrome-", extra = [], timeoutMs = START_TIMEOUT_MS } = {},
) {
  const profile = mkdtempSync(join(tmpdir(), prefix));
  const proc = spawn(chrome, chromeArgs({ profile, extra }), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  let exitCode = null;
  proc.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  proc.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  const stop = () => {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
    else proc.kill();
  };
  const fail = () => {
    stop();
    return new Error(failureMessage({ timeoutMs, exitCode, stderr }));
  };
  const end = Date.now() + timeoutMs;
  const port = await waitForPort(profile, { timeoutMs, exited: () => exitCode !== null });
  if (port === undefined) throw fail();
  while (Date.now() < end && exitCode === null) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      if (wsUrl !== undefined) return { proc, profile, wsUrl, stop };
    } catch {
      // port file written but the HTTP side is not answering yet
    }
    await sleep(100);
  }
  throw fail();
}
