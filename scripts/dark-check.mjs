// SPDX-License-Identifier: AGPL-3.0-only
// Dark mode check for the web UI with headless Chrome over the DevTools protocol.
// Not part of `mise run check`. Start the dev server first (another PORT than 5173), then:
//   node scripts/dark-check.mjs [base-url]
// With `prefers-color-scheme: dark` at 1440x900, 1280x800 and 390x844, every screen and dialog is
// opened and checked: text must reach WCAG AA (4.5:1, 3:1 for large text), and a bordered or filled
// control or card must stand out from what is behind it (border or fill at least 1.3:1, form
// fields 3:1). Exit 1 on any failure.
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

const sample = (hash) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `location.hash = '${hash}'`,
];
const tender = (hash) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `(() => {
    const d = JSON.parse(localStorage.getItem('green-garden'));
    d.plants.push({ id: 't1', spaceId: d.plants[0].spaceId, name: 'Agapanthus', species: 'Agapanthus africanus', style: 'let_top_dry', intervalDays: 7, placement: 'outdoor_pot', logs: [{ date: '2026-11-01', outcome: 'done' }] });
    d.settings.climate = 'oceanic_wet'; d.settings.winterMin = 'H4';
    localStorage.setItem('green-garden', JSON.stringify(d));
  })()`,
  "location.reload()",
  "(() => { const i = document.getElementById('today'); i.value = '2026-11-09'; i.dispatchEvent(new Event('change', { bubbles: true })); })()",
  `location.hash = '${hash}'`,
];
const bulk = (...more) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=add-many]').click()",
  "(() => { const t = document.querySelector('#bulk-text'); t.value = 'ivy-leaved geranium'; t.dispatchEvent(new Event('input', { bubbles: true })); })()",
  "document.querySelector('[data-action=bulk-match]').click()",
  ...more,
];

export const SCREENS = [
  ["today", sample("today")],
  ["plants", sample("plants")],
  ["improve", sample("improve")],
  ["planning", sample("planning")],
  ["settings", sample("settings")],
  ["add-plant", [...sample("plants"), "document.querySelector('[data-action=add-plant]').click()"]],
  ["bulk-add", bulk()],
  [
    "bulk-picked",
    bulk(
      "document.querySelector('[data-action=bulk-pick]').click()",
      "document.querySelector('[data-action=bulk-next]').click()",
    ),
  ],
  [
    "move-sheet",
    [...tender("today"), "document.querySelector('[data-action=season-move]').click()"],
  ],
  [
    "load-banner",
    [
      ...sample("today"),
      "(() => { const d = JSON.parse(localStorage.getItem('green-garden')); d.version = 99999; localStorage.setItem('green-garden', JSON.stringify(d)); })()",
      "location.reload()",
    ],
  ],
];
const SIZES = [
  [1440, 900, false],
  [1280, 800, false],
  [390, 844, true],
];

/** Runs in the page: every failure on what is visible now, as strings. */
const AUDIT = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    let acc = [255, 255, 255, 1];
    for (const e of chain.reverse()) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) acc = over(c, acc);
    }
    return acc;
  };
  const parentBg = (el) => (el.parentElement ? bgOf(el.parentElement) : [255, 255, 255, 1]);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + (el.dataset && el.dataset.action ? '[' + el.dataset.action + ']' : '');
  const out = [];
  const modal = document.querySelector('dialog[open]');
  const root = modal ?? document.body;
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    const field = el.matches('input:not([type=checkbox],[type=radio]),select,textarea');
    if (own || (field && (el.value !== '' || el.placeholder))) {
      const fgRaw = rgba(s.color);
      const bg = bgOf(el);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * Number(s.opacity)], bg);
      const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      const r = ratio(fg, bg);
      if (r < need) out.push('text ' + name(el) + ' "' + (el.textContent || el.value).trim().slice(0, 30) + '" ' + r.toFixed(2) + ' < ' + need);
    }
    const box = el.matches('button,input:not([type=checkbox],[type=radio]),select,textarea,article,details.alts,[role=tab],.notice');
    if (box) {
      const pbg = parentBg(el), bg = bgOf(el);
      const side = ['Top', 'Right', 'Bottom', 'Left'].find((x) => parseFloat(s['border' + x + 'Width']) > 0 && s['border' + x + 'Style'] !== 'none');
      const bc = side ? over(rgba(s['border' + side + 'Color']), bg) : null;
      const fillOk = ratio(bg, pbg) >= 1.3;
      const borderOk = bc !== null && ratio(bc, pbg) >= 1.3;
      const shadow = s.boxShadow !== 'none';
      if (!fillOk && !borderOk && !shadow) out.push('edge ' + name(el) + ' blends in (fill ' + ratio(bg, pbg).toFixed(2) + (bc ? ', border ' + ratio(bc, pbg).toFixed(2) : ', no border') + ')');
      if (field && Math.max(bc ? ratio(bc, pbg) : 1, ratio(bg, pbg)) < 3) out.push('field ' + name(el) + ' edge below 3:1 (' + Math.max(bc ? ratio(bc, pbg) : 1, ratio(bg, pbg)).toFixed(2) + ')');
    }
  }
  return [...new Set(out)];
})()`;

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "gg-dark-"))}`,
  "--no-first-run",
  "--hide-scrollbars",
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
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
};

let failures = 0;
try {
  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  for (const [width, height, mobile] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    for (const [name, steps] of SCREENS) {
      await send("Page.navigate", { url: "about:blank" });
      await send("Page.navigate", { url: base });
      await sleep(800);
      await evalIn("localStorage.clear()");
      await send("Page.reload");
      await sleep(1000);
      for (const step of steps) {
        await evalIn(step);
        await sleep(350);
      }
      const dark = await evalIn("matchMedia('(prefers-color-scheme: dark)').matches");
      if (!dark) throw new Error("dark mode emulation is not on");
      const found = await evalIn(AUDIT);
      for (const f of found) console.log(`FAIL ${width}x${height} ${name}: ${f}`);
      failures += found.length;
    }
  }
} finally {
  ws.close();
  proc.kill();
}
console.log(failures === 0 ? "dark mode: all screens pass" : `dark mode: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
