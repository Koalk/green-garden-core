// SPDX-License-Identifier: AGPL-3.0-only
// Browser check of the static preview with headless Chrome over the DevTools protocol. Not part of
// `pnpm check` (it serves the build over loopback HTTP); run by `mise run preview-check` and by the
// preview job in CI before it deploys. Builds the preview, serves it under a sub-path (like Pages
// does for a project site) and, at 390x844 and 1440x900, checks:
//   - no console errors, no uncaught exceptions, no failed requests;
//   - not one request to a /api/ route (the build holds no server address);
//   - the "Preview" label shows, the sample garden loads, the calendar download button is there;
//   - Settings has no weather form, and the Data tab has the export but no server, reminders or
//     Home Assistant block.
// Exit 1 on any failure. CHROME points at a browser when it is not found in the usual places.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { buildStatic } from "./build-static.mjs";

const chrome = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]
  .filter((p) => p !== undefined)
  .find((p) => existsSync(p));
if (chrome === undefined) throw new Error("no Chrome found; set CHROME");

const out = buildStatic(mkdtempSync(join(tmpdir(), "gg-static-")));
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".webp": "image/webp",
};
const requests = [];
const server = createServer((req, res) => {
  const url = req.url ?? "/";
  requests.push(url);
  const rel = decodeURIComponent(url.split("?")[0]).replace(/^\/preview\//, "");
  const full = normalize(join(out, rel === "" ? "index.html" : rel));
  if (!url.startsWith("/preview/") || !full.startsWith(out) || !existsSync(full)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(full)] ?? "application/octet-stream" });
  res.end(readFileSync(full));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;

const port = 9800 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), "gg-static-chrome-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "about:blank",
]);
const stopAll = () => {
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
  else proc.kill();
  server.close();
};
let wsUrl;
for (let i = 0; i < 50 && wsUrl === undefined; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {
    // still starting
  }
  if (wsUrl === undefined) await sleep(200);
}
if (wsUrl === undefined) {
  stopAll();
  throw new Error("Chrome did not open a page");
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const problems = [];
let nextId = 1;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.exceptionThrown") {
    problems.push(msg.params.exceptionDetails.exception?.description ?? "uncaught exception");
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    problems.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    problems.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  }
  const w = waiting.get(msg.id);
  if (w === undefined) return;
  waiting.delete(msg.id);
  if (msg.error) w.reject(new Error(msg.error.message));
  else w.resolve(msg.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
};
const go = async (hash) => {
  await evalIn(`location.hash = '${hash}'`);
  await sleep(300);
};
const panel = () => evalIn("document.getElementById('panel').innerHTML");

let failures = 0;
const check = (size, ok, what) => {
  if (ok) return;
  failures++;
  console.log(`FAIL ${size}: ${what}`);
};
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  for (const [width, height, mobile] of [
    [390, 844, true],
    [1440, 900, false],
  ]) {
    const size = `${String(width)}x${String(height)}`;
    problems.length = 0;
    requests.length = 0;
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url: base });
    await sleep(800);
    await evalIn("localStorage.clear()");
    await send("Page.reload");
    await sleep(1000);
    check(size, /Preview/.test(await evalIn("document.body.innerText")), "no Preview label");
    await go("plants");
    await evalIn("document.querySelector('[data-action=sample]').click()");
    await sleep(400);
    for (const tab of ["today", "planning", "plants"]) await go(tab);
    await go("settings");
    check(size, !/data-form="weather"/.test(await panel()), "Settings shows the weather form");
    await go("data");
    const data = await panel();
    check(size, /data-action="export"/.test(data), "Data tab has no export");
    check(
      size,
      !/data-form="server"|data-action="ha-areas"|data-form="reminders"/.test(data),
      "Data tab shows a server-only block",
    );
    await go("today");
    check(
      size,
      await evalIn("document.querySelector('[data-action=ics]') !== null"),
      "no calendar download button on Today",
    );
    for (const p of problems) check(size, false, `console: ${p}`);
    for (const u of requests.filter((r) => r.includes("/api/"))) check(size, false, `request ${u}`);
  }
} finally {
  ws.close();
  stopAll();
  await sleep(500);
  try {
    rmSync(out, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome may still hold its profile for a moment; the temp folders are not in the repo
  }
}
console.log(
  failures === 0
    ? "static preview: all checks pass"
    : `static preview: ${String(failures)} failures`,
);
process.exit(failures === 0 ? 0 : 1);
