// SPDX-License-Identifier: AGPL-3.0-only
// Checks control sizes in the web UI with headless Chrome over the DevTools protocol.
// Not part of `mise run check`. Start the dev server first (another PORT than 5173), then:
//   node scripts/control-sizes.mjs [base-url]
// Desktop 1440x900: a button, text input, select and date input on Today, Plants (Add plant dialog)
// and Planning each have font size == body font size and height <= 2.4 x font size.
// Phone 390x844: the same controls keep at least 44 px height. Exit 1 on any failure.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:5181/";
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

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "gg-ctl-"))}`,
  "--no-first-run",
  "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
if (wsUrl === undefined) throw new Error("Chrome did not open a page");
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
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.text}`);
  return r.result.value;
};

// Reads the visible controls of each kind in the current view (and the open dialog, if any).
const MEASURE = `(() => {
  const body = parseFloat(getComputedStyle(document.body).fontSize);
  const kinds = {
    button: 'button:not([role=tab])',
    text: 'input:not([type=checkbox],[type=radio],[type=date],[type=hidden],[type=file],[type=range])',
    select: 'select',
    date: 'input[type=date]',
  };
  const out = { body, kinds: {} };
  for (const [k, sel] of Object.entries(kinds)) {
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.classList.contains('close');
    });
    out.kinds[k] = els.map((e) => {
      const cs = getComputedStyle(e);
      const rg = document.createRange(); rg.selectNodeContents(e);
      const wrapped = new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size > 1;
      return { font: parseFloat(cs.fontSize), h: e.getBoundingClientRect().height, wrapped, badge: e.classList.contains('bang'), label: (e.name || e.id || e.textContent || '').trim().slice(0, 24) };
    });
  }
  return out;
})()`;

const VIEWS = [
  ["today", ["location.hash = 'today'"]],
  [
    "plants-add-dialog",
    [
      "location.hash = 'plants'",
      "document.querySelector('[data-action=sample]')?.click()",
      "document.querySelector('[data-action=add-plant]').click()",
    ],
  ],
  ["planning", ["location.hash = 'planning'"]],
];

const failures = [];
try {
  await send("Page.enable");
  for (const [mode, w, h, mobile] of [
    ["desktop", 1440, 900, false],
    ["phone", 390, 844, true],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile,
    });
    for (const scheme of ["light", "dark"]) {
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: scheme }],
      });
      for (const [view, steps] of VIEWS) {
        await send("Page.navigate", { url: "about:blank" });
        await send("Page.navigate", { url: base });
        await sleep(800);
        await evalJs("localStorage.clear()");
        await send("Page.reload");
        await sleep(1200);
        for (const s of steps) {
          await evalJs(s);
          await sleep(400);
        }
        const m = await evalJs(MEASURE);
        for (const [kind, list] of Object.entries(m.kinds)) {
          for (const c of list) {
            const where = `${mode}/${scheme}/${view}/${kind} "${c.label}"`;
            if (mode === "desktop") {
              if (Math.abs(c.font - m.body) > 0.6)
                failures.push(`${where}: font ${c.font}px != body ${m.body}px`);
              if (c.h > 2.4 * c.font && !c.wrapped)
                failures.push(`${where}: height ${c.h.toFixed(1)}px > 2.4 x ${c.font}px`);
            } else if (c.h < 43.5 && !c.badge)
              failures.push(`${where}: touch height ${c.h.toFixed(1)}px < 44px`);
          }
        }
        console.log(
          `${mode}/${scheme}/${view}: body ${m.body}px, ` +
            Object.entries(m.kinds)
              .map(([k, l]) => `${k}=${l.length}`)
              .join(" "),
        );
      }
    }
  }
} finally {
  ws.close();
  proc.kill();
}
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):\n` + failures.join("\n"));
  process.exit(1);
}
console.log("control sizes ok");
