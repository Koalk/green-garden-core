// SPDX-License-Identifier: AGPL-3.0-only
// Layout check for the web UI with headless Chrome over the DevTools protocol.
// Not part of `mise run check`. Run `mise run layout-check`, which starts its own dev server on a free
// port and stops it again. Or pass the address of a running one: `node scripts/layout-check.mjs <url>`.
// Against a sample garden of at least six plants it checks:
//   1440x900: plant cards sit in more than one column, and the content is wider than 60rem;
//   1100x800: Today's list and the calendar sit side by side;
//   390x844:  no card's button row has more than two buttons on one line.
// Exit 1 on any failure.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chrome = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter((p) => p !== undefined)
  .find((p) => existsSync(p));
if (chrome === undefined) throw new Error("no Chrome found; set CHROME");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Without an address: our own dev server, local only, on a port that is not 5173 or 5191.
let server;
let base = process.argv[2];
if (base === undefined) {
  const serverPort = 5300 + Math.floor(Math.random() * 500);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "web-ui");
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dev/server.mjs"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(serverPort) },
    stdio: "ignore",
  });
  base = `http://127.0.0.1:${serverPort}/`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      // still starting
    }
    await sleep(200);
  }
}

const SEED = `(() => {
  const d = JSON.parse(localStorage.getItem('green-garden'));
  const names = ['Basil', 'Mint', 'Thyme', 'Rosemary', 'Sage', 'Chives', 'Parsley', 'Fern'];
  for (const [i, name] of names.entries()) d.plants.push({ id: 'lc' + i, spaceId: d.plants[0].spaceId, name, species: name, style: 'let_top_dry', intervalDays: 7, placement: 'outdoor_pot', logs: [{ date: '2026-11-01', outcome: 'done' }] });
  localStorage.setItem('green-garden', JSON.stringify(d));
})()`;
const rem = "parseFloat(getComputedStyle(document.documentElement).fontSize)";
const CHECKS = [
  {
    width: 1440,
    height: 900,
    mobile: false,
    hash: "plants",
    run: `(() => {
      const out = [];
      const cards = [...document.querySelectorAll('main .grid > article')].filter((a) => a.getBoundingClientRect().width > 0);
      if (cards.length < 6) out.push('only ' + cards.length + ' plant cards, need at least 6');
      const cols = new Set(cards.map((a) => Math.round(a.getBoundingClientRect().left)));
      if (cols.size < 2) out.push('plant cards sit in ' + cols.size + ' column');
      const w = document.querySelector('main').getBoundingClientRect().width, limit = 60 * ${rem};
      if (!(w > limit)) out.push('content is ' + Math.round(w) + 'px wide, not wider than 60rem (' + limit + 'px)');
      return out;
    })()`,
  },
  {
    width: 1100,
    height: 800,
    mobile: false,
    hash: "today",
    run: `(() => {
      const panel = document.querySelector('#panel'), cal = document.querySelector('#calendar');
      if (!panel || !cal) return ['no #panel or #calendar on Today'];
      const list = [...panel.children].find((c) => c !== cal && c.getBoundingClientRect().height > 0);
      if (!list) return ['no Today list beside the calendar'];
      const a = list.getBoundingClientRect(), b = cal.getBoundingClientRect();
      const out = [];
      if (!(b.left >= a.right - 1)) out.push('calendar (left ' + Math.round(b.left) + ') is not to the right of the list (right ' + Math.round(a.right) + ')');
      if (!(b.top < a.bottom && a.top < b.bottom)) out.push('calendar and list do not share a row');
      return out;
    })()`,
  },
  {
    width: 390,
    height: 844,
    mobile: true,
    hash: "plants",
    run: `(() => {
      const out = [];
      const rows = [...document.querySelectorAll('article.card > p')].filter((p) => p.querySelector(':scope > button'));
      if (rows.length === 0) out.push('no card button rows found');
      for (const p of rows) {
        const lines = new Map();
        for (const b of p.querySelectorAll(':scope > button')) {
          const t = Math.round(b.getBoundingClientRect().top);
          lines.set(t, (lines.get(t) ?? 0) + 1);
        }
        const most = Math.max(...lines.values());
        if (most > 2) out.push('card button row has ' + most + ' buttons on one line');
      }
      return [...new Set(out)];
    })()`,
  },
];

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "gg-layout-"))}`,
  "--no-first-run",
  "--hide-scrollbars",
  "about:blank",
]);
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
  proc.kill();
  server?.kill();
  throw new Error("Chrome did not open a page");
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
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

let failures = 0;
try {
  await send("Page.enable");
  for (const { width, height, mobile, hash, run } of CHECKS) {
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
    for (const step of [
      "location.hash = 'plants'",
      "document.querySelector('[data-action=sample]').click()",
      SEED,
      "location.reload()",
      `location.hash = '${hash}'`,
    ]) {
      await evalIn(step);
      await sleep(500);
    }
    const found = await evalIn(run);
    for (const f of found) console.log(`FAIL ${width}x${height} ${hash}: ${f}`);
    failures += found.length;
  }
} finally {
  ws.close();
  proc.kill();
  server?.kill();
}
console.log(failures === 0 ? "layout: all checks pass" : `layout: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
