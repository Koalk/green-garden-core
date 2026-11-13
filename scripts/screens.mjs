// SPDX-License-Identifier: AGPL-3.0-only
// Screenshots of the web UI with headless Chrome over the DevTools protocol, for the session notes.
// Not part of `mise run check`. Start the dev server first (another PORT than 5173), then:
//   node scripts/screens.mjs <set> <out-dir> [base-url]
// <set> is one of the shot lists below. Every shot is taken at desktop (900) and phone (390, `phone-`
// prefix) width, light and dark. CHROME overrides the browser path.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Load the sample garden (every shot starts on an empty store), then show `hash`. */
const sample = (hash) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `location.hash = '${hash}'`,
];

/**
 * the sample garden plus four plants outdoors and a climate; `day` is the simulated "today".
 * A summer day shows the rain-fed line and the drought check, a November day the resting plants.
 */
const outdoor = (day, hash, withClimate = true) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `(() => {
    const d = JSON.parse(localStorage.getItem('green-garden'));
    const base = { spaceId: d.plants[0].spaceId, style: 'let_top_dry', intervalDays: 7 };
    d.plants.push(
      { ...base, id: 'o1', name: 'Lavender', placement: 'ground', droughtTolerance: 'high', rootDepth: 'deep', logs: [{ date: '2026-06-01', outcome: 'done' }] },
      { ...base, id: 'o2', name: 'Holly', placement: 'ground', droughtTolerance: 'none', dormancy: 'none', logs: [{ date: '2026-09-01', outcome: 'done' }] },
      { ...base, id: 'o3', name: 'Hydrangea', placement: 'ground', droughtTolerance: 'none', plantedOn: '2026-06-20', establishmentSeasons: 2, logs: [{ date: '2026-07-10', outcome: 'done' }] },
      { ...base, id: 'o4', name: 'Porch pot', placement: 'outdoor_pot', sheltered: true, logs: [{ date: '2026-07-10', outcome: 'done' }] },
    );
    ${withClimate ? "d.settings.climate = 'oceanic_wet'; d.settings.winterMin = 'H4';" : ""}
    localStorage.setItem('green-garden', JSON.stringify(d));
  })()`,
  "location.reload()",
  `(() => { const i = document.getElementById('today'); i.value = '${day}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  `location.hash = '${hash}'`,
];

/**
 * the add-plant dialog in `locale` with `query` typed in the species box; `pick` opens the first
 * result's species card (Learn more), otherwise the list shows (no match: "Not sure what it is?").
 */
const learn = (locale, query, pick) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `(() => { const d = JSON.parse(localStorage.getItem('green-garden')); d.settings.locale = '${locale}'; localStorage.setItem('green-garden', JSON.stringify(d)); })()`,
  "location.reload()",
  "document.querySelector('[data-action=add-plant]').click()",
  `(() => { const i = document.querySelector('input[name=speciesSearch]'); i.value = '${query}'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  ...(pick ? ["document.querySelector('[data-action=pick]').click()"] : []),
];

/**
 * weather switched on through the Settings form, with the server's answer stubbed in the page (the
 * shots never call a weather source). `notices` shows the AEMET key warning in Settings.
 */
const weather = (hash, notices = []) => [
  ...outdoor("2026-11-07", "settings"),
  `(() => {
    const day = (date, rainMm, kind, forecast) => ({ date, rainMm, kind, ...(forecast ? { forecast: true } : {}) });
    const prov = (day, kind, extra = {}) => ({ provider: kind === 'measured' ? 'sepa' : 'open-meteo', dataset: 'd', day, boundary: 'utc_day', retrievedAt: '2026-11-07T10:00:00Z', quality: 'raw', kind, licenceId: 'l', attribution: 'a', ...extra });
    const reply = {
      days: [day('2026-11-04', 0.2, 'measured'), day('2026-11-05', 1.4, 'measured'), day('2026-11-06', 6.8, 'measured'), day('2026-11-07', 0.6, 'modelled'), day('2026-11-08', 9, 'modelled', true)],
      provenance: [prov('2026-11-04', 'measured', { stationLabel: 'Blackford Hill', distanceKm: 3.1 }), prov('2026-11-05', 'measured', { stationLabel: 'Blackford Hill', distanceKm: 3.1 }), prov('2026-11-06', 'measured', { stationLabel: 'Gogarbank', distanceKm: 6.4 }), prov('2026-11-07', 'modelled'), prov('2026-11-08', 'modelled')],
      attributions: ['Weather data by Open-Meteo.com', 'Contains SEPA data © Scottish Environment Protection Agency and database right 2026. All rights reserved'],
      notices: ${JSON.stringify(notices)},
      fetchedAt: '2026-11-07T10:00:00Z',
    };
    const real = window.fetch;
    window.fetch = (u, i) => String(u).includes('/api/weather') ? Promise.resolve(new Response(JSON.stringify(reply), { status: 200 })) : real(u, i);
    const f = document.querySelector('form[data-form=weather]');
    f.querySelector('[name=enabled]').checked = true;
    f.querySelector('[name=lat]').value = '55.95';
    f.querySelector('[name=lon]').value = '-3.19';
    f.requestSubmit();
  })()`,
  `location.hash = '${hash}'`,
];

/** the sample garden plus a tender potted plant outside, a climate, and a November day. */
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

/** sample garden with every plant last watered long ago (warnings), plus an away stretch. */
const stale = (hash) => [
  "location.hash = 'plants'",
  "document.querySelector('[data-action=sample]').click()",
  `(() => {
    const d = JSON.parse(localStorage.getItem('green-garden'));
    for (const p of d.plants) p.lastWatered = '2026-09-01';
    d.spaces[0].awayDates = ['2026-11-12', '2026-11-13', '2026-11-14'];
    localStorage.setItem('green-garden', JSON.stringify(d));
  })()`,
  "location.reload()",
  `location.hash = '${hash}'`,
];

const SETS = {
  // control sizes at desktop width (run with DESKTOP_W=1440 DESKTOP_H=900).
  s240: [
    { name: "01-today", steps: sample("today") },
    { name: "02-plants", steps: sample("plants") },
    { name: "03-planning", steps: sample("planning") },
    {
      name: "04-add-dialog",
      viewport: true,
      steps: [...sample("plants"), "document.querySelector('[data-action=add-plant]').click()"],
    },
  ],
  // fixes from the first click-through (desktop sizing, alternatives control, Away mark, warnings).
  polish: [
    { name: "01-plants", steps: sample("plants") },
    { name: "02-today-warnings", steps: stale("today") },
    { name: "03-calendar-away", steps: stale("today") },
    {
      name: "04-add-alternatives",
      viewport: true,
      steps: [
        ...sample("plants"),
        "document.querySelector('[data-action=add-plant]').click()",
        "(() => { const i = document.querySelector('[name=speciesSearch]'); i.value = 'pilea'; i.dispatchEvent(new Event('input', { bubbles: true })); })()",
        "(() => { const i = document.querySelector('[name=speciesSearch]'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()",
        "document.querySelector('details.alts').open = true",
      ],
    },
  ],
  // the seasonal card and move sheet on Today, the outdoor rows (Under cover, Direct sun) in the add dialog.
  s225: [
    { name: "01-today-card", steps: tender("today") },
    {
      name: "02-move-sheet",
      steps: [...tender("today"), "document.querySelector('[data-action=season-move]').click()"],
    },
    {
      name: "03-add-outdoor-rows",
      viewport: true,
      steps: [
        ...tender("plants"),
        "document.querySelector('[data-action=add-plant]').click()",
        "document.querySelector('[data-action=placement-chip][data-value=outdoor_pot]').click()",
        "document.querySelector('[data-action=cover-chip][data-value=covered]').click()",
        "document.querySelector('[data-action=sun-preset][data-value=not_midday]').click()",
      ],
    },
  ],
  // the move sheet with its interval line, and the Plants list with sun hours today in the details.
  move: [
    {
      name: "01-move-sheet",
      steps: [...tender("today"), "document.querySelector('[data-action=season-move]').click()"],
    },
    {
      name: "02-plants-details",
      steps: [
        ...tender("plants"),
        "document.querySelectorAll('details').forEach((d) => { d.open = true; })",
      ],
    },
  ],
  // "Learn more" (es and en) and "Not sure what it is?" in the add-plant dialog.
  s156: [
    { name: "01-learn-es", viewport: true, steps: learn("es", "dracaena", true) },
    { name: "02-learn-en", viewport: true, steps: learn("en", "dracaena", true) },
    { name: "03-notsure-es", viewport: true, steps: learn("es", "xyzzy", false) },
    { name: "04-notsure-en", viewport: true, steps: learn("en", "xyzzy", false) },
  ],
  // the rain marks and credits in Outdoors on Today, the weather block and Data sources in Settings.
  s189: [
    { name: "01-today-rain", steps: weather("today") },
    {
      name: "02-settings-weather",
      steps: weather("settings", [{ code: "aemet_key_expiring", daysLeft: 9 }]),
    },
  ],
  // outdoor care on Today and the plant cards, the resting plants, Q-K0 in Settings and as a gate.
  s173: [
    { name: "01-today-summer", steps: outdoor("2026-07-15", "today") },
    { name: "02-plants-summer", steps: outdoor("2026-07-15", "plants") },
    { name: "03-today-resting", steps: outdoor("2026-11-03", "today") },
    { name: "04-settings-home", steps: outdoor("2026-07-15", "settings", false) },
    {
      name: "05-home-gate",
      viewport: true,
      steps: [
        ...outdoor("2026-07-15", "plants", false),
        "(() => { const s = document.querySelector('select[data-detail-q=Q-LIVES]'); s.value = 'ground'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
      ],
    },
  ],
  // placement chips in the add-plant dialog; the second shot picks "In the ground" with no climate (Q-K0 gate).
  s197: [
    {
      name: "01-add-chips",
      viewport: true,
      steps: [...sample("plants"), "document.querySelector('[data-action=add-plant]').click()"],
    },
    {
      name: "02-chip-gate",
      viewport: true,
      steps: [
        ...sample("plants"),
        "document.querySelector('[data-action=add-plant]').click()",
        "document.querySelector('[data-action=placement-chip][data-value=ground]').click()",
      ],
    },
  ],
  // fixes from the first browser run: bulk add after the garden question is dismissed, Pilea in Add plant,
  // and Today right after a bulk add with "I watered all of these today".
  s263: [
    {
      name: "01-bulk-garden-dismissed",
      viewport: true,
      steps: [
        "location.hash = 'plants'",
        "document.querySelector('[data-action=add-many]').click()",
        "(() => { const t = document.querySelector('#bulk-text'); t.value = 'ivy-leaved geranium'; t.dispatchEvent(new Event('input', { bubbles: true })); })()",
        "document.querySelector('[data-action=bulk-match]').click()",
        "document.querySelector('[data-action=bulk-pick]').click()",
        "document.querySelector('[data-action=bulk-next]').click()",
        "document.querySelector('[data-action=bulk-placement][data-value=outdoor_pot]').click()",
        "document.querySelector('[data-action=bulk-next]').click()",
        "document.querySelector('[data-action=bulk-save]').click()",
        "document.querySelector('[data-action=home-cancel]').click()",
      ],
    },
    {
      name: "02-add-pilea",
      viewport: true,
      steps: [
        ...sample("plants"),
        "document.querySelector('[data-action=add-plant]').click()",
        "(() => { const i = document.querySelector('input[name=speciesSearch]'); i.value = 'pilea'; i.dispatchEvent(new Event('input', { bubbles: true })); })()",
        "document.querySelector('[data-action=pick][data-id=pilea-peperomioides]').click()",
      ],
    },
    {
      name: "03-today-after-bulk",
      steps: [
        "location.hash = 'plants'",
        "document.querySelector('[data-action=add-many]').click()",
        "(() => { const t = document.querySelector('#bulk-text'); t.value = 'ivy-leaved geranium'; t.dispatchEvent(new Event('input', { bubbles: true })); })()",
        "document.querySelector('[data-action=bulk-match]').click()",
        "document.querySelector('[data-action=bulk-pick]').click()",
        "document.querySelector('[data-action=bulk-next]').click()",
        "document.querySelector('[data-action=bulk-next]').click()",
        "document.querySelector('[data-action=bulk-watered][data-value=today]').click()",
        "document.querySelector('[data-action=bulk-save]').click()",
        "location.hash = 'today'",
      ],
    },
  ],
  // the dark mode pass: every screen and dialog (dark-check.mjs checks the same list for contrast).
  s264: [
    { name: "01-today", steps: sample("today") },
    { name: "02-plants", steps: sample("plants") },
    { name: "03-improve", steps: sample("improve") },
    { name: "04-planning", steps: sample("planning") },
    { name: "05-settings", steps: sample("settings") },
    {
      name: "06-add-plant",
      viewport: true,
      steps: [...sample("plants"), "document.querySelector('[data-action=add-plant]').click()"],
    },
    {
      name: "07-bulk-add",
      viewport: true,
      steps: [
        "location.hash = 'plants'",
        "document.querySelector('[data-action=add-many]').click()",
        "(() => { const t = document.querySelector('#bulk-text'); t.value = 'ivy-leaved geranium'; t.dispatchEvent(new Event('input', { bubbles: true })); })()",
        "document.querySelector('[data-action=bulk-match]').click()",
        "document.querySelector('[data-action=bulk-pick]').click()",
        "document.querySelector('[data-action=bulk-next]').click()",
      ],
    },
    {
      name: "08-move-sheet",
      steps: [...tender("today"), "document.querySelector('[data-action=season-move]').click()"],
    },
    {
      name: "09-load-banner",
      steps: [
        ...sample("today"),
        "(() => { const d = JSON.parse(localStorage.getItem('green-garden')); d.version = 99999; localStorage.setItem('green-garden', JSON.stringify(d)); })()",
        "location.reload()",
      ],
    },
  ],
  // the Planning tab (was Holidays) and the Settings tab with the preferences.
  s119: [
    { name: "01-planning", steps: sample("planning") },
    { name: "02-settings", steps: sample("settings") },
  ],
  // the Pico restyle on Today, Plants and the add-plant dialog.
  s64: [
    { name: "01-today", steps: sample("today") },
    { name: "02-plants", steps: sample("plants") },
    {
      name: "03-add-plant",
      viewport: true,
      steps: [...sample("plants"), "document.querySelector('[data-action=add-plant]').click()"],
    },
  ],
};

const [set, out, base = "http://127.0.0.1:5181/"] = process.argv.slice(2);
const shots = SETS[set];
if (shots === undefined || out === undefined) {
  console.error(
    `usage: node scripts/screens.mjs <${Object.keys(SETS).join("|")}> <out-dir> [base-url]`,
  );
  process.exit(2);
}

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p) => p !== undefined);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (chrome === undefined) throw new Error("no Chrome found; set CHROME");

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "gg-screens-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--hide-scrollbars",
  "about:blank",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting
    }
    await sleep(200);
  }
  throw new Error("Chrome did not open a page");
}

const ws = new WebSocket(await pageSocket());
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
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.text}`);
};

mkdirSync(out, { recursive: true });
await send("Page.enable");
try {
  for (const [prefix, width, height] of [
    ["", Number(process.env.DESKTOP_W ?? 900), Number(process.env.DESKTOP_H ?? 1100)],
    ["phone-", 390, 844],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: prefix !== "",
    });
    for (const scheme of ["light", "dark"]) {
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: scheme }],
      });
      for (const shot of shots) {
        await send("Page.navigate", { url: "about:blank" });
        await send("Page.navigate", { url: base });
        await sleep(800);
        await run("localStorage.clear()");
        await send("Page.reload");
        await sleep(1200);
        for (const step of shot.steps) {
          await run(step);
          await sleep(400);
        }
        // The whole page, or only the viewport for a shot with `viewport` (a full-screen dialog).
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        const full = shot.viewport === true ? height : Math.max(height, cssContentSize.height);
        const { data } = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height: full, scale: 1 },
        });
        const file = join(out, `${prefix}${shot.name}-${scheme}.png`);
        writeFileSync(file, Buffer.from(data, "base64"));
        console.log(file);
      }
    }
  }
} finally {
  ws.close();
  proc.kill();
}
