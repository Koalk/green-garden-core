// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser shell: renders plain HTML from the view models and wires the forms. No framework.
 * PROVISIONAL: layout, wording and the single-page structure are the simplest thing that
 * lets every function be exercised; none of it is a design decision.
 */
import { askHomePending, cancelHomePending, type HomePending } from "./home-pending.ts";
import { RemoteBackend } from "@green-garden/client";
import { type LogOutcome, type PlanResult } from "@green-garden/engine";
import {
  BrowserStore,
  exportData,
  earlierWateringRange,
  importData,
  logWateredEarlier,
  spaceView,
  type AppData,
  type Plant,
} from "@green-garden/storage";
import {
  addAwayRange,
  addRoom,
  deletePlant,
  deleteRoom,
  logOutcome,
  pinPreLeave,
  setCalibration,
  setRoomLight,
  cantWaterToday,
  logRain,
  waterAll,
  removeAwayDate,
} from "./actions.ts";
import {
  amountInputFor,
  calibrationFromMeasurement,
  amountLines,
  amountPrefs,
  linesText,
  containerMl,
} from "./amount.ts";
import {
  answerFollowUp,
  draftFromSettings,
  homeQuestionNeeded,
  pickClimate,
  pickRegion,
  pickWinterMin,
  saveHome,
  type HomeDraft,
} from "@green-garden/bulk";
import { healthTexts } from "./health.ts";
import { applyMove, moveSheetHtml, moveTarget, undoMove } from "./moves.ts";
import {
  applyCardChoice,
  cardPrompts,
  cardsHtml,
  loadCardState,
  saveCardState,
} from "./seasonal-cards.ts";
import { formatRanges } from "./sun-hours.ts";
import { homeDialogHtml } from "./home-view.ts";
import {
  bedAmountWords,
  dueExtrasHtml,
  outdoorBlockHtml,
  canLogRain,
  rainButtonsHtml,
  todayOutdoorHtml,
} from "./outdoor.ts";
import { areaChecklistHtml, haFailureText, importRooms } from "./ha-rooms.ts";
import { remindersHtml, setReminders } from "./reminders-form.ts";
import { ProxyAreas, type Area } from "@green-garden/providers";
import { setWeather } from "@green-garden/storage";
import { loadWeather } from "./weather-client.ts";
import {
  getWeatherState,
  rainDetailHtml,
  saveWeather,
  setWeatherState,
  weatherDays,
  weatherPoint,
} from "./weather-view.ts";
import { deleteDraft } from "./drafts.ts";
import { isBulkDraft } from "./bulk-flow.ts";
import { notAddedHtml } from "./bulk-view.ts";
import { createBulkModal } from "./bulk-modal.ts";
import { toxicityOfPlant, toxicityPopupOfPlant } from "./species.ts";
import { fixtureData } from "./fixture.ts";
import { NO_FILL, draftsHtml } from "./modal.ts";
import { esc, t, tHtml } from "./text.ts";
import { getLocale, negotiateLocale, setLocale } from "@green-garden/i18n";
import { createNotice } from "./notice.ts";
import {
  SyncSession,
  loadSyncConfig,
  saveSyncConfig,
  syncHtml,
  syncMessageKey,
  type Connected,
  type SyncConfig,
  type SyncStatus,
} from "./sync.ts";
import { createPlantModal } from "./plant-modal.ts";
import { planningHtml, savePlanning, saveSettings, settingsHtml } from "./settings-view.ts";
import { legacyHash, tabFromHash, TABS, type Tab } from "./tabs.ts";
import {
  ROOM_PREFIX,
  answerQuestion,
  answersThisSitting,
  neverAskAboutPlant,
  neverAskQuestion,
  nextForSitting,
  questionFor,
  roomIsWaiting,
  setQuestionsSetting,
  snoozeQuestion,
  theyDiffer,
  waitingPlants,
  improveRows,
  type Ask,
} from "./improve.ts";
import { askEndHtml, askHtml, bangHtml, detailHtml, improveHtml } from "./improve-view.ts";
import { toIcs } from "./ics.ts";
import {
  aroundPlants,
  calendarWeeks,
  cardWords,
  dayEntries,
  localIsoDate,
  makePlan,
  isDueRow,
  plantRows,
  type PlantRow,
  warnings,
  weekHeaders,
  weekStartOf,
  bulkConfirmText,
  importReasons,
  todayLine,
  windowsFor,
} from "./view.ts";

const store = new BrowserStore(window.localStorage);
let data: AppData = store.load();
let today = localIsoDate(new Date());
/** An old `#holidays` link (the tab is now Planning) is rewritten in place, no history entry. */
function rewriteLegacyHash(): void {
  const next = legacyHash(window.location.hash);
  if (next !== undefined) window.history.replaceState(null, "", next);
}
rewriteLegacyHash();
let tab: Tab = tabFromHash(window.location.hash);
/** `#improve` is a view of the Plants tab, not a tab of its own. */
const improveFromHash = (): boolean => window.location.hash === "#improve";
let improveOpen = improveFromHash();
/** The question being asked in a voluntary run, and how the run is going. */
let ask: Ask | undefined;
let askEnded: "plenty" | "none" | undefined;
let answered = 0;
let lastAnswerAt = 0;
let skippedInRun: string[] = [];
const skippedInList = new Set<string>();
/** The plant whose detail is open after "Fill all for this plant". */
let detailOpenFor: string | undefined;
/** The plant whose "Watered it earlier?" date question is open. */
let earlierFor: string | undefined;

/** The plant whose Bring inside / Put outside sheet is open. */
let moveFor: string | undefined;
/** The plant as it was before the last move, offered back for 10 seconds. */
let undoPlant: Plant | undefined;
let undoTimer: number | undefined;
let cardState = loadCardState();

/** Q-K0: the draft being edited, and the save held back until the person has answered it. */
let homeDraft: HomeDraft = draftFromSettings(data.settings);
let homePending: HomePending | undefined;

const root = document.getElementById("app");
if (root === null) throw new Error("missing #app");
const homeRoot = document.getElementById("home-root");
if (homeRoot === null) throw new Error("missing #home-root");
// Escape closes the Q-K0 dialog like "Not now": the held-back plant is not saved.
homeRoot.addEventListener(
  "close",
  () => {
    if (homePending === undefined) return;
    const held = homePending;
    homePending = undefined;
    cancelHomePending(held);
    render();
    notice.show(t("home.notice.cancelled"));
  },
  true,
);

/** Status messages are transient: they expire, and the next action or a tab change clears them. */
const notice = createNotice(
  (fn, ms) => window.setTimeout(fn, ms),
  (id) => {
    window.clearTimeout(id);
  },
  () => {
    render();
  },
);

// The optional server: when one is chosen, every change is also sent to it. The browser copy stays
// as the cache, and a stale save is refused by the server rather than overwriting another device.
let syncConfig = loadSyncConfig(window.localStorage);
let sync: SyncSession | undefined;
function startSync(config: SyncConfig | undefined): void {
  syncConfig = config;
  sync =
    config === undefined
      ? undefined
      : new SyncSession(
          new RemoteBackend({
            url: config.url,
            token: config.token,
            fetchFn: (url, init) => window.fetch(url, init),
          }),
        );
}
startSync(syncConfig);

function reportSync(status: SyncStatus): void {
  const key = syncMessageKey(status);
  if (key !== undefined) notice.show(t(key));
}

/** The plan from the data, with the rain the weather sources reported when weather is on. */
function currentPlan(): ReturnType<typeof makePlan> {
  return makePlan(data, today, undefined, weatherDays(data, getWeatherState()));
}

let weatherSignature = "";
let weatherBusy = false;

/**
 * Asks the server for the rain around the home point (it caches an hour) and redraws only when the
 * answer changed. With weather off or no point, the state is cleared and manual rain is all there is.
 */
function refreshWeather(): void {
  const point = weatherPoint(data);
  if (point === undefined) {
    const had = weatherSignature !== "";
    setWeatherState({});
    weatherSignature = "";
    if (had) render();
    return;
  }
  if (weatherBusy) return;
  weatherBusy = true;
  const before = getWeatherState();
  if (before.reply === undefined) setWeatherState({ loading: true });
  void loadWeather(
    (url, init) => window.fetch(url, init),
    syncConfig,
    point,
    localIsoDate(new Date()),
  )
    .then((r) => {
      const prev = getWeatherState();
      setWeatherState(
        r.ok
          ? { reply: r.reply }
          : { ...(prev.reply === undefined ? {} : { reply: prev.reply }), failure: r.reason },
      );
      const next = getWeatherState();
      const sig = JSON.stringify([
        next.reply?.days,
        next.reply?.notices,
        next.reply?.stale,
        next.failure,
      ]);
      if (sig !== weatherSignature) {
        weatherSignature = sig;
        render();
      }
    })
    .finally(() => {
      weatherBusy = false;
    });
}

/** Takes data that came from the server as the current state (no echo back to the server). */
function adopt(next: AppData, message: string): void {
  data = next;
  notice.clear();
  store.save(data);
  render();
  notice.show(message);
  refreshWeather();
}

function reportConnected(r: Connected): void {
  if (r.kind === "remote") adopt(r.data, t("sync.loaded", { n: r.data.plants.length }));
  else if (r.kind === "failed") reportSync(r.status);
}

function commit(next: AppData, message = ""): void {
  data = next;
  notice.clear();
  store.save(data);
  render();
  notice.show(message);
  if (sync !== undefined) void sync.push(data).then(reportSync);
}

/**
 * Saves a change that may put a plant outdoors. While no climate is set, the first outdoor plant waits
 * for Q-K0: cancelling drops the change, it is never saved with the fallback climate.
 */
function commitPlants(next: AppData, message = "", then?: () => void): void {
  if (!homeQuestionNeeded(data, next)) {
    commit(next, message);
    return;
  }
  homeDraft = draftFromSettings(data.settings);
  homePending = { next, message, ...(then === undefined ? {} : { then }) };
  render();
}

/** Today list: Done, Skip, Still wet (Dry early lives on the plant cards). Buttons carry the plant's name in their accessible text, so "Done" is not repeated ten times. */
function outcomeButtons(id: string, name: string): string {
  const b = (o: LogOutcome): string => {
    const label = t(`outcome.${o}`);
    return `<button data-action="log" data-id="${esc(id)}" data-outcome="${o}" aria-label="${tHtml("outcome.aria", { label, name })}">${esc(label)}</button>`;
  };
  return [b("done"), b("skipped"), b("still_wet")].join(" ");
}

/** PROVISIONAL: what Today says about a plant that already has a log for today. */
function todayNote(logged: readonly LogOutcome[]): string {
  if (logged.includes("skipped")) return t("today.note.skipped");
  if (logged.includes("still_wet")) return t("today.note.still_wet");
  if (logged.includes("dry_early")) return t("today.note.dry_early");
  return "";
}

function todaySection(plan: ReturnType<typeof makePlan>): string {
  const dueExtras = (id: string): string => {
    const plant = data.plants.find((x) => x.id === id);
    return plant === undefined ? "" : dueExtrasHtml(plan, data, plant, today);
  };
  const entries = dayEntries(plan, data, today, aroundPlants(windowsFor(data, today)));
  const warn = warnings(plan, data, today);
  const upcoming = plan.days.filter((d) => d.date > today).slice(0, 7);
  const list = entries
    .map((e) => {
      const head = `<strong>${esc(e.name)}</strong>${e.room === undefined ? "" : ` (${esc(e.room)})`}`;
      if (e.handled) {
        return `<li class="handled">${head}<br><small>${esc(todayNote(e.loggedToday))}</small></li>`;
      }
      const note = e.loggedToday.length === 0 ? "" : ` ${esc(todayNote(e.loggedToday))}`;
      return `<li>${head}<br><small>${esc(todayLine(e))}${note}</small>${dueExtras(e.plantId)}<br>${outcomeButtons(e.plantId, e.name)}</li>`;
    })
    .join("");
  const open = entries.filter((e) => !e.handled).length;
  const bulkButtons =
    open === 0
      ? ""
      : `<button data-action="water-all">${esc(t("today.waterAll", { n: open }))}</button>
        <button data-action="cant-water">${esc(t("today.cantWater"))}</button>`;
  const warnList = warn
    .map((w) => {
      const links = w.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(" · ");
      return `<li class="sev${w.severity}">${esc(w.text)} <small>${links}</small></li>`;
    })
    .join("");
  const soon = upcoming
    .map((d) => {
      const names = dayEntries(plan, data, d.date).map((e) => esc(e.name));
      return `<li>${esc(d.date)}: ${names.join(", ")}</li>`;
    })
    .join("");
  return `<section id="today"><h2>${esc(t("today.heading", { date: today }))}</h2>
    ${
      entries.length === 0
        ? `<p>${esc(t("today.empty"))}</p>`
        : `<p>${bulkButtons}</p><ul>${list}</ul>`
    }
    ${cardsHtml(cardPrompts(data, weatherDays(data, getWeatherState()), today, cardState), data.plants)}
    ${moveBlockHtml()}
    ${todayOutdoorHtml(plan, data, weatherPoint(data) === undefined ? "" : rainDetailHtml(getWeatherState(), today))}
    ${warn.length === 0 ? "" : `<h3>${esc(t("today.warnings"))}</h3><ul>${warnList}</ul>`}
    <h3>${esc(t("today.next7"))}</h3>${soon === "" ? `<p>${esc(t("common.noneCapital"))}</p>` : `<ul>${soon}</ul>`}
    <p><small>${esc(
      t("today.summary", {
        wateringDays: plan.summary.wateringDays,
        naiveDays: plan.summary.naiveDays,
        savingPercent: plan.summary.savingPercent,
      }),
    )}</small></p>
    ${plan.issues.length === 0 ? "" : `<p class="err">${esc(t("today.engineIssues", { issues: plan.issues.join("; ") }))}</p>`}
  </section>`;
}

function calendarSection(plan: ReturnType<typeof makePlan>): string {
  const weekStart = weekStartOf(data, getLocale());
  const weeks = calendarWeeks(plan, data, today, data.settings.horizonDays, weekStart);
  const head = weekHeaders(weekStart, getLocale())
    .map((d) => `<th scope="col">${esc(d)}</th>`)
    .join("");
  const rows = weeks
    .map(
      (w) =>
        `<tr>${w
          .map((c) => {
            const cls = [c.inPlan ? "" : "out", c.isToday ? "today" : "", c.away ? "away" : ""]
              .filter((x) => x !== "")
              .join(" ");
            const names = c.plantNames.map((n) => `<div>${esc(n)}</div>`).join("");
            return `<td class="${cls}"><small>${esc(c.date.slice(5))}${c.away ? ` <span class="away-mark" role="img" aria-label="${esc(t("calendar.away"))}">✈ ${esc(t("calendar.away"))}</span>` : ""}</small>${names}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<section id="calendar"><h2>${esc(t("calendar.heading"))}</h2>
    <table><caption>${esc(t("calendar.caption"))}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    <p><button data-action="ics">${esc(t("calendar.ics"))}</button></p></section>`;
}

/** Plants with a "!" in the Plants view being drawn (set by plantsSection). */
let waitingNow: readonly string[] = [];

/** "Watered it earlier?" replaces Dry early on a day the plant is due. */
function earlierButtonHtml(p: Plant): string {
  return `<button data-action="earlier" data-id="${esc(p.id)}" aria-label="${tHtml("earlier.aria", { name: p.name })}">${esc(t("earlier.button"))}</button>`;
}

/** The date question: today by default, never in the future, never before the last watering. */
function earlierFormHtml(p: Plant): string {
  const range = earlierWateringRange(p, today);
  if (range === undefined) return "";
  return `<form data-form="earlier" data-id="${esc(p.id)}"><label>${esc(t("earlier.date"))}
      <input type="date" name="date" autocomplete="off" required value="${esc(today)}" min="${esc(range.min)}" max="${esc(range.max)}"></label>
      <button type="submit">${esc(t("common.save"))}</button>
      <button type="button" data-action="earlier-cancel">${esc(t("earlier.cancel"))}</button></form>`;
}

/** The move sheet, when it is open for a plant, and the undo line after a move. */
function moveBlockHtml(): string {
  const plant = moveFor === undefined ? undefined : data.plants.find((x) => x.id === moveFor);
  const sheet = plant === undefined ? "" : moveSheetHtml(plant, today, spaceView(data).rooms);
  const undo =
    undoPlant === undefined
      ? ""
      : `<p class="undo"><button data-action="move-undo">${esc(t("move.undo"))}</button></p>`;
  return sheet + undo;
}

/** The button on a plant card: the other of indoors and a pot outside; none for a ground plant. */
function moveButtonHtml(p: Plant): string {
  const target = moveTarget(p);
  if (target === undefined) return "";
  const label = t(target === "indoor" ? "move.bringIn" : "move.putOut");
  return `<button data-action="move" data-id="${esc(p.id)}" aria-label="${esc(label)}: ${esc(p.name)}">${esc(label)}</button>`;
}

/** "Ask about a problem": a symptoms field and two copy buttons. Copy only, nothing is sent. */
function healthBlockHtml(p: Plant): string {
  const who = esc(p.name);
  return `<div class="health"><label>${esc(t("healthcheck.field"))}
      <input name="symptoms" autocomplete="off"></label>
    <button type="button" data-action="health-copy" data-id="${esc(p.id)}" aria-label="${esc(t("healthcheck.button"))}: ${who}">${esc(t("healthcheck.button"))}</button>
    <button type="button" data-action="health-search" data-id="${esc(p.id)}" aria-label="${esc(t("healthcheck.search"))}: ${who}">${esc(t("healthcheck.search"))}</button>
    <small>${esc(t("healthcheck.note"))}</small></div>`;
}

function plantCard(r: PlantRow, plan: PlanResult): string {
  const { plant: p, overdueDays } = r;
  const words = cardWords(r);
  const lines = amountLines(amountInputFor(data, p), amountPrefs(data.settings));
  // A plant in a bed is worded in watering cans or minutes with the hose, never ml (02k 1.3).
  const amount = bedAmountWords(p) ?? linesText(lines);
  const outdoor = outdoorBlockHtml(plan, data, p, today, { rain: false });
  const resting =
    plan.rainFed.some((x) => x.plantId === p.id) || plan.dormant.some((x) => x.plantId === p.id);
  const rain = canLogRain(p)
    ? `<dt>${esc(t("outdoor.rained"))}</dt><dd>${rainButtonsHtml(p.id, p.name)}</dd>`
    : "";
  // One quiet line under the amount: where it came from, or a link to measure it once.
  const note =
    lines.note === undefined
      ? ""
      : `<br><small>${lines.basis === undefined ? `<a href="#settings">${esc(lines.note)}</a>` : esc(lines.note)}</small>`;
  const adjust =
    lines.adjustNote === undefined ? "" : `<br><small>${esc(lines.adjustNote)}</small>`;
  const logs = (p.logs ?? [])
    .slice(-5)
    .map((l) => `${esc(l.date)} ${esc(l.outcome)}`)
    .join(", ");
  const dryNote = (p.logs ?? []).some((l) => l.date === today && l.outcome === "dry_early")
    ? ` <small>${esc(t("card.dryEarlyToday"))}</small>`
    : "";
  return `<article class="card"><h4>${esc(p.name)}${waitingNow.includes(p.id) ? ` ${bangHtml(p.id, p.name)}` : ""}</h4>
    <p><small>${esc(p.species ?? "")}</small></p>
    ${toxicityPopupOfPlant(p)}
    ${outdoor}
    ${
      resting
        ? ""
        : `<p>${esc(words.next)}
      ${overdueDays > 0 ? `<span class="err badge">${tHtml("card.overdue", { n: overdueDays })}</span>` : ""}${dryNote}</p>`
    }
    <p>${resting ? "" : isDueRow(r, today) ? earlierButtonHtml(p) : `<button data-action="log" data-id="${esc(p.id)}" data-outcome="dry_early" aria-label="${tHtml("card.ariaDryEarly", { name: p.name })}">${esc(t("outcome.dry_early"))}</button>`}
      <button data-action="edit" data-id="${esc(p.id)}" aria-label="${tHtml("card.ariaEdit", { name: p.name })}">${esc(t("common.edit"))}</button>
      ${moveButtonHtml(p)}
      <button data-action="delete" data-id="${esc(p.id)}" aria-label="${tHtml("card.ariaDelete", { name: p.name })}">${esc(t("common.delete"))}</button></p>
    ${earlierFor === p.id ? earlierFormHtml(p) : ""}
    ${moveFor === p.id ? moveSheetHtml(p, today, spaceView(data).rooms) : ""}
    <details${detailOpenFor === p.id ? " open" : ""}><summary>${esc(t("card.details"))}</summary><dl>
      <dt>${esc(t("card.care"))}</dt><dd>${esc(words.care)}
        ${p.restFactor === undefined ? "" : tHtml("card.restFactor", { factor: p.restFactor })}</dd>
      <dt>${esc(t("card.window"))}</dt><dd>${esc(words.window)}</dd>
      ${p.directSun === undefined ? "" : `<dt>${esc(t("sun.legend"))}</dt><dd>${p.directSun.length === 0 ? esc(t("sun.preset.none")) : esc(formatRanges(p.directSun))}</dd>`}
      <dt>${esc(t("card.howMuch"))}</dt><dd>${esc(amount)}${bedAmountWords(p) === undefined ? `${adjust}${note}` : ""}</dd>
      ${rain}
      <dt>${esc(t("tox.label"))}</dt><dd>${esc(toxicityOfPlant(p, data.settings.household))}</dd>
      <dt>${esc(t("card.source"))}</dt><dd>${esc(p.source ?? t("card.sourceNone"))}</dd>
      <dt>${esc(t("card.lastLogs"))}</dt><dd>${logs === "" ? esc(t("common.none")) : logs}</dd>
    </dl>${detailHtml(data, p.id)}${healthBlockHtml(p)}</details></article>`;
}

function plantsSection(plan: ReturnType<typeof makePlan>): string {
  if (improveOpen) return improveHtml(data, today, skippedInList);
  const shown = spaceView(data);
  waitingNow = waitingPlants(data, today);
  // The plan input's windows: multipliers and the margin of assumed values included.
  const windows = windowsFor(data, today);
  const rows = plantRows(plan, windows, shown);
  const inRoom = (x: (typeof rows)[number], id: string): boolean => x.plant.roomId === id;
  const groups = [
    ...shown.rooms.map((r) => ({
      title: r.light === undefined ? r.name : `${r.name} (${t(`light.${r.light}`)})`,
      bang: roomIsWaiting(data, r.id, today) ? bangHtml(`${ROOM_PREFIX}${r.id}`, r.name) : "",
      rows: rows.filter((x) => inRoom(x, r.id)),
    })),
    {
      title: t("plants.noRoom"),
      bang: "",
      rows: rows.filter((x) => !shown.rooms.some((r) => inRoom(x, r.id))),
    },
  ].filter((g) => g.rows.length > 0);
  const grid = groups
    .map(
      (g) =>
        `<h3>${esc(g.title)}${g.bang === "" ? "" : ` ${g.bang}`}</h3><div class="grid">${g.rows.map((x) => plantCard(x, plan)).join("")}</div>`,
    )
    .join("");
  const empty =
    shown.plants.length === 0
      ? `<p>${esc(t("plants.empty"))} <button data-action="sample" class="secondary">${esc(t("plants.loadSample"))}</button></p>`
      : "";
  const open = improveRows(data, today);
  const things = open.reduce((n, r) => n + r.questions.length, 0);
  const improveLink =
    things === 0
      ? ""
      : `<p><a href="#improve">${esc(t("improve.link"))}</a> <small>(${esc(
          t("improve.summary", { plants: open.length, things }),
        )})</small></p>`;
  const drafts = shown.drafts ?? [];
  const leftovers = drafts.filter((d) => d.fields["notAdded"] !== undefined);
  const others = drafts.filter((d) => d.fields["notAdded"] === undefined && !isBulkDraft(d));
  return `<section id="plants"><h2>${esc(t("plants.heading"))}</h2>${empty}<p><button data-action="add-many">${esc(t("plants.addMany"))}</button>
    <button data-action="add-plant" class="secondary">${esc(t("plants.add"))}</button></p>${improveLink}${askPanel()}${notAddedHtml(leftovers)}${draftsHtml(others)}${grid}${roomsSection()}</section>`;
}

/** The open question of a voluntary run, or the end of it. */
function askPanel(): string {
  if (ask !== undefined) return askHtml(data, ask, waitingPlants(data, today).length);
  return askEnded === undefined ? "" : askEndHtml(askEnded === "plenty");
}

const LIGHTS = ["low", "medium", "bright_indirect", "direct"] as const;

function lightOptions(chosen: (typeof LIGHTS)[number] | undefined): string {
  return [
    `<option value=""${chosen === undefined ? " selected" : ""}>${esc(t("room.lightNone"))}</option>`,
    ...LIGHTS.map(
      (l) =>
        `<option value="${l}"${chosen === l ? " selected" : ""}>${esc(t(`light.${l}`))}</option>`,
    ),
  ].join("");
}

function roomsSection(): string {
  const list = spaceView(data)
    .rooms.map(
      (r) =>
        `<li>${esc(r.name)} <label>${esc(t("room.light"))} <select data-room-light="${esc(r.id)}">${lightOptions(r.light)}</select></label> <button data-action="delete-room" data-id="${esc(r.id)}" aria-label="${tHtml("rooms.ariaDelete", { name: r.name })}">${esc(t("common.delete"))}</button></li>`,
    )
    .join("");
  return `<section id="rooms"><h3>${esc(t("rooms.heading"))}</h3><ul>${list}</ul>
    <form data-form="room"><label>${esc(t("rooms.new"))} <input name="roomName" required autocomplete="off"></label>
    <button type="submit">${esc(t("common.add"))}</button></form></section>`;
}

/** The Home Assistant import: nothing, a wait message, the pick list or what went wrong. */
let ha:
  | { state: "idle" }
  | { state: "loading" }
  | { state: "areas"; areas: readonly Area[] }
  | { state: "error"; text: string } = {
  state: "idle",
};

function haHtml(): string {
  switch (ha.state) {
    case "idle":
      return "";
    case "loading":
      return `<p>${esc(t("ha.loading"))}</p>`;
    case "error":
      return `<p class="err">${esc(ha.text)}</p>`;
    case "areas":
      return areaChecklistHtml(ha.areas, data);
  }
}

function dataSection(): string {
  return `<section id="data"><h2>${esc(t("data.heading"))}</h2>
    <p><button data-action="export">${esc(t("data.download"))}</button></p>
    <form data-form="import"><label>${esc(t("data.import"))}
    <input type="file" name="file" accept="application/json,.json" required></label>
    <button type="submit">${esc(t("data.importButton"))}</button></form>
    ${syncHtml(syncConfig)}
    ${remindersHtml(data)}
    <h3>${esc(t("ha.heading"))}</h3>
    <p><button data-action="ha-areas">${esc(t("ha.button"))}</button></p>
    <div id="ha-result" aria-live="polite">${haHtml()}</div></section>`;
}

function panel(plan: ReturnType<typeof makePlan>): string {
  switch (tab) {
    case "today":
      return todaySection(plan) + calendarSection(plan);
    case "plants":
      return plantsSection(plan);
    case "planning":
      return planningHtml(data, today);
    case "settings":
      return settingsHtml(data, homeDraft);
    case "data":
      return dataSection();
  }
}

/** The UI language: the chosen one, or the device language matched against what we ship. */
function applyLocale(d: AppData = data): void {
  const chosen = d.settings.locale;
  const locale =
    chosen === undefined
      ? negotiateLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language])
      : chosen;
  setLocale(locale);
  document.documentElement.lang = getLocale();
  document.title = t("app.documentTitle");
}

function render(): void {
  const app = root;
  if (app === null) return;
  applyLocale();
  // what the plan shows as a pre-leave watering is pinned, so a later click on another
  // plant cannot move it.
  const pinned = pinPreLeave(data, today);
  if (pinned !== data) {
    data = pinned;
    store.save(data);
  }
  const plan = currentPlan();
  app.innerHTML = `
    <header><h1>${esc(t("app.title"))}</h1>
      <p><small>${esc(t("header.note"))}
      <label for="today" style="display:inline">${esc(t("header.todayLabel"))}</label>
      <input id="today" name="simulatedToday" type="date" ${NO_FILL} value="${esc(today)}">
      ${esc(t("header.todayHint"))}</small></p>
      <div role="tablist" aria-label="${esc(t("tabs.label"))}">${TABS.map(
        (id) =>
          `<button role="tab" id="tab-${id}" aria-selected="${id === tab}" aria-controls="panel" data-action="tab" data-tab="${id}">${esc(t(`tab.${id}`))}</button>`,
      ).join(" ")}</div>
      ${notice.text() === "" ? "" : `<p role="status" class="notice">${esc(notice.text())}</p>`}
    </header>
    <div role="tabpanel" id="panel" aria-labelledby="tab-${tab}">${panel(plan)}</div>`;
  if (homeRoot !== null) {
    homeRoot.innerHTML = homePending === undefined ? "" : homeDialogHtml(homeDraft);
    const dlg = homeRoot.querySelector("dialog");
    if (dlg !== null && !dlg.open) dlg.showModal();
  }
}

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function num(f: FormData, k: string): number | undefined {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;
}

function text(f: FormData, k: string): string | undefined {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const onClick = (ev: Event): void => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (el === null) return;
  const { action, id, outcome, date } = el.dataset;
  switch (action) {
    case "log":
      if (id !== undefined && outcome !== undefined) {
        commit(
          logOutcome(data, id, outcome as LogOutcome, today),
          t("notice.logged", { outcome: t(`outcome.name.${outcome as LogOutcome}`), date: today }),
        );
      }
      break;
    case "health-copy":
    case "health-search": {
      const symptoms =
        el.closest("article")?.querySelector<HTMLInputElement>('input[name="symptoms"]')?.value ??
        "";
      const texts = id === undefined ? undefined : healthTexts(data, id, today, symptoms);
      if (texts !== undefined) {
        const out = action === "health-copy" ? texts.chat : texts.search;
        void navigator.clipboard.writeText(out).then(
          () => {
            notice.show(t("healthcheck.copied"));
          },
          () => undefined,
        );
      }
      break;
    }
    case "earlier":
      earlierFor = id;
      render();
      break;
    case "move":
    case "season-move":
      moveFor = id;
      render();
      break;
    case "move-cancel":
      moveFor = undefined;
      render();
      break;
    case "move-undo":
      if (undoPlant !== undefined) {
        const back = undoMove(data, undoPlant);
        undoPlant = undefined;
        commit(back);
      }
      break;
    case "season-snooze":
    case "season-leave":
      if (id !== undefined) {
        cardState = applyCardChoice(
          cardState,
          id,
          action === "season-snooze" ? "snooze" : "leave",
          today,
          data.settings.hemisphere,
        );
        saveCardState(cardState);
        render();
      }
      break;
    case "earlier-cancel":
      earlierFor = undefined;
      render();
      break;
    case "rain":
      if (id !== undefined && el.dataset["mm"] !== undefined) {
        const mm = Number(el.dataset["mm"]);
        commit(
          logRain(data, [id], mm, today),
          t("notice.logged", { outcome: t("outcome.name.rain"), date: today }),
        );
      }
      break;
    case "rain-all":
      if (el.dataset["mm"] !== undefined) {
        commit(
          logRain(
            data,
            spaceView(data).plants.map((p) => p.id),
            Number(el.dataset["mm"]),
            today,
          ),
          t("notice.logged", { outcome: t("outcome.name.rain"), date: today }),
        );
      }
      break;
    case "home-cancel": {
      const held = homePending;
      homePending = undefined;
      cancelHomePending(held);
      render();
      notice.show(t("home.notice.cancelled"));
      break;
    }
    case "water-all": {
      const ids = dayEntries(currentPlan(), data, today)
        .filter((e) => !e.handled)
        .map((e) => e.plantId);
      if (ids.length > 0 && window.confirm(bulkConfirmText("water-all", ids.length))) {
        commit(waterAll(data, ids, today), t("notice.wateredAll", { n: ids.length }));
      }
      break;
    }
    case "cant-water": {
      const count = dayEntries(currentPlan(), data, today).filter((e) => !e.handled).length;
      if (window.confirm(bulkConfirmText("cant-water", count))) {
        commit(cantWaterToday(data, today), t("notice.cantWater", { date: today }));
      }
      break;
    }
    case "tab": {
      const t = el.dataset["tab"];
      if (t !== undefined) window.location.hash = t;
      break;
    }
    case "add-many":
      bulkModal.open();
      break;
    case "ask": {
      const target = el.dataset["target"];
      const q = target === undefined ? undefined : questionFor(data, target, today);
      if (target !== undefined && q !== undefined) {
        ask = { target, question: q };
        askEnded = undefined;
        skippedInRun = [];
        answered = answersThisSitting(answered, lastAnswerAt, Date.now());
        render();
      }
      break;
    }
    case "answer": {
      const { target, q, value, mode } = el.dataset;
      if (target === undefined || q === undefined || value === undefined) break;
      const run = mode === "run";
      const now = Date.now();
      if (run) answered = answersThisSitting(answered, lastAnswerAt, now) + 1;
      lastAnswerAt = now;
      const answeredData = answerQuestion(data, target, q, value, today, { voluntary: run });
      // An answer can move a plant outdoors; with no climate yet that waits for Q-K0.
      commitPlants(answeredData, "", () => {
        if (run) advanceRun();
      });
      if (homePending === undefined) {
        // Not held back: the run moves on from the data just saved, as it always did.
        if (run) {
          advanceRun();
          render();
        }
      }
      break;
    }
    case "they-differ": {
      const { target, q } = el.dataset;
      if (target !== undefined && q !== undefined) commit(theyDiffer(data, target, q));
      break;
    }
    case "ask-later":
    case "ask-never":
    case "ask-never-plant": {
      const { target, q } = el.dataset;
      if (target === undefined) break;
      if (action === "ask-later" && q !== undefined) data = snoozeQuestion(data, target, q, today);
      else if (action === "ask-never" && q !== undefined) data = neverAskQuestion(data, target, q);
      else if (action === "ask-never-plant") data = neverAskAboutPlant(data, target);
      if (ask !== undefined) advanceRun();
      commit(data);
      break;
    }
    case "ask-skip":
      if (ask !== undefined) {
        skippedInRun.push(ask.target);
        advanceRun();
        render();
      }
      break;
    case "ask-close":
      ask = undefined;
      askEnded = undefined;
      render();
      break;
    case "improve-skip":
      if (el.dataset["target"] !== undefined && el.dataset["q"] !== undefined) {
        skippedInList.add(`${el.dataset["target"]}|${el.dataset["q"]}`);
        render();
      }
      break;
    case "fill-all":
      detailOpenFor = id;
      window.location.hash = "plants";
      break;
    case "add-plant":
      plantModal.open();
      break;
    case "edit":
      if (id !== undefined) plantModal.openPlant(id);
      break;
    case "resume-draft":
      if (id !== undefined) plantModal.openDraft(id);
      break;
    case "delete-draft":
      if (id !== undefined && window.confirm(t("confirm.deleteDraft")))
        commit(deleteDraft(data, id), t("notice.draftDeleted"));
      break;
    case "delete":
      if (id !== undefined && window.confirm(t("confirm.deletePlant")))
        commit(deletePlant(data, id), t("notice.plantDeleted"));
      break;
    case "delete-room":
      if (id !== undefined) commit(deleteRoom(data, id), t("notice.roomDeleted"));
      break;
    case "reset-calibration": {
      const level = el.dataset["level"];
      const target =
        level === "global"
          ? ({ kind: "global" } as const)
          : id === undefined
            ? undefined
            : level === "room"
              ? ({ kind: "room", id } as const)
              : ({ kind: "plant", id } as const);
      if (target !== undefined)
        commit(setCalibration(data, target, undefined), t("notice.calibrationReset"));
      break;
    }
    case "ha-areas":
      ha = { state: "loading" };
      render();
      void new ProxyAreas((url) => window.fetch(url)).listAreas().then((r) => {
        ha = r.ok
          ? { state: "areas", areas: r.areas }
          : { state: "error", text: haFailureText(r.reason) };
        render();
      });
      break;
    case "remove-away":
      if (date !== undefined) commit(removeAwayDate(data, date));
      break;
    case "sample":
      commit(fixtureData(today), t("notice.sampleLoaded"));
      break;
    case "ics":
      download("watering-plan.ics", "text/calendar", toIcs(currentPlan(), data, today));
      break;
    case "export":
      download("green-garden.json", "application/json", exportData(data));
      break;
    case "server-pull":
      if (sync !== undefined) void sync.pull().then(reportConnected);
      break;
    case "weather-locate": {
      // The browser's location is read once, on this click; only the point rounded to about 1 km is kept.
      const form = el.closest("form");
      const enabled = form?.querySelector<HTMLInputElement>('input[name="enabled"]')?.checked;
      const here = (pos: GeolocationPosition): void => {
        commit(
          setWeather(data, {
            enabled: enabled ?? data.settings.weather?.enabled ?? false,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }),
          t("weather.located"),
        );
        refreshWeather();
      };
      if (!("geolocation" in navigator)) notice.show(t("weather.locateFailed"));
      else
        navigator.geolocation.getCurrentPosition(here, () => {
          notice.show(t("weather.locateFailed"));
        });
      break;
    }
    case "server-off":
      saveSyncConfig(window.localStorage, undefined);
      startSync(undefined);
      notice.clear();
      render();
      notice.show(t("sync.disconnected"));
      break;
  }
};

root.addEventListener("click", onClick);
homeRoot.addEventListener("click", onClick);

/** After an answer, a skip or a snooze: the next question of the run, or why it stopped. */
function advanceRun(): void {
  const count = answersThisSitting(answered, lastAnswerAt, Date.now());
  ask = nextForSitting(data, today, count, skippedInRun);
  askEnded = ask === undefined ? (count >= 5 ? "plenty" : "none") : undefined;
}

/** Q-K0 selects (Settings and the gate dialog): each change updates the draft and redraws. */
function changeHome(kind: string, el: HTMLInputElement): void {
  if (kind === "region") homeDraft = pickRegion(homeDraft, el.value);
  else if (kind === "follow")
    homeDraft = answerFollowUp(homeDraft, Number(el.dataset["index"]), el.value);
  else if (kind === "climate") homeDraft = pickClimate(homeDraft, el.value);
  else if (kind === "winterMin") homeDraft = pickWinterMin(homeDraft, el.value);
  render();
}

const onChange = (ev: Event): void => {
  const el = ev.target as HTMLInputElement;
  const homeKind = el.dataset["home"];
  if (homeKind !== undefined) {
    changeHome(homeKind, el);
    return;
  }
  if (el.dataset["questionsSetting"] !== undefined) {
    commit(setQuestionsSetting(data, el.checked ? "off" : "on"));
    return;
  }
  const detailQ = el.dataset["detailQ"];
  if (detailQ !== undefined) {
    const target = el.dataset["target"];
    if (target !== undefined && el.value !== "") {
      commitPlants(answerQuestion(data, target, detailQ, el.value, today));
    }
    return;
  }
  if (el.dataset["roomLight"] !== undefined) {
    const light = LIGHTS.find((l) => l === el.value);
    commit(setRoomLight(data, el.dataset["roomLight"], light));
    return;
  }
  if (el.id === "today" && /^\d{4}-\d{2}-\d{2}$/.test(el.value)) {
    today = el.value;
    notice.clear();
    render();
    return;
  }
};
root.addEventListener("change", onChange);
homeRoot.addEventListener("change", onChange);

window.addEventListener("hashchange", () => {
  rewriteLegacyHash();
  tab = tabFromHash(window.location.hash);
  improveOpen = improveFromHash();
  notice.clear();
  render();
});

const onSubmit = (ev: Event): void => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const f = new FormData(form);
  switch (form.dataset["form"]) {
    case "earlier": {
      const id = form.dataset["id"];
      const date = text(f, "date");
      const next =
        id === undefined || date === undefined
          ? undefined
          : logWateredEarlier(data, id, date, today);
      earlierFor = undefined;
      if (next === undefined) {
        render();
        notice.show(t("earlier.invalid"));
      } else
        commit(next, t("notice.logged", { outcome: t("outcome.name.done"), date: date ?? today }));
      break;
    }
    case "move": {
      const id = form.dataset["id"];
      const date = text(f, "date");
      const before = data.plants.find((x) => x.id === id);
      const roomId = text(f, "roomId");
      const next =
        id === undefined || date === undefined || before === undefined
          ? undefined
          : applyMove(
              data,
              id,
              {
                on: date,
                sheltered: text(f, "sheltered") === "1",
                ...(roomId === undefined ? {} : { roomId }),
              },
              today,
            );
      moveFor = undefined;
      if (next === undefined || before === undefined) {
        render();
        notice.show(t("move.invalid"));
      } else {
        undoPlant = before;
        window.clearTimeout(undoTimer);
        undoTimer = window.setTimeout(() => {
          undoPlant = undefined;
          render();
        }, 10_000);
        commit(next, t("move.moved", { name: before.name }));
      }
      break;
    }
    case "room":
      commit(addRoom(data, text(f, "roomName") ?? ""));
      break;
    case "away": {
      const next = addAwayRange(data, text(f, "from") ?? "", text(f, "to") ?? "");
      if (next === undefined) {
        notice.show(t("notice.awayInvalid"));
      } else commit(next, t("notice.awayAdded"));
      break;
    }
    case "ha-rooms": {
      const chosen = f.getAll("area").map(String);
      const before = data.rooms.length;
      const next = importRooms(data, ha.state === "areas" ? ha.areas : [], chosen);
      ha = { state: "idle" };
      commit(next, t("notice.roomsImported", { n: next.rooms.length - before }));
      break;
    }
    case "calibration": {
      const level = text(f, "level");
      const plant = data.plants.find((p) => p.id === text(f, "plantId"));
      const amount = num(f, "amount");
      const prefs = amountPrefs(data.settings);
      const ml =
        amount === undefined
          ? Number.NaN
          : text(f, "unit") === "ml" || prefs.measure === "none"
            ? amount
            : amount * containerMl(prefs.measure);
      const cal =
        plant === undefined || (level !== "global" && level !== "room" && level !== "plant")
          ? undefined
          : calibrationFromMeasurement(level, amountInputFor(data, plant), ml);
      const target =
        level === "global"
          ? ({ kind: "global" } as const)
          : level === "room"
            ? ({ kind: "room", id: text(f, "roomId") ?? "" } as const)
            : ({ kind: "plant", id: plant?.id ?? "" } as const);
      const next = cal === undefined ? undefined : setCalibration(data, target, cal);
      if (next === undefined || next === data) notice.show(t("notice.calibrationInvalid"));
      else commit(next, t("notice.calibrationSaved"));
      break;
    }
    case "planning":
      commit(savePlanning(data, f), t("notice.prefsSaved"));
      break;
    case "home": {
      // Q-K0: the draft holds every choice, the selects only redraw it. A held-back save goes
      // through together with the answer; both values must be there.
      const base = homePending?.next ?? data;
      const saved = saveHome(base, homeDraft);
      if (saved === undefined) {
        notice.show(t("home.notice.incomplete"));
        break;
      }
      const held = homePending;
      homePending = undefined;
      if (held === undefined) {
        commit(saved, t("home.notice.saved"));
      } else {
        data = saved;
        held.then?.();
        commit(data, held.message === "" ? t("home.notice.saved") : held.message);
      }
      homeDraft = draftFromSettings(data.settings);
      break;
    }
    case "settings": {
      const next = saveSettings(data, f);
      applyLocale(next); // so the confirmation is worded in the language just chosen
      commit(next, t("notice.prefsSaved"));
      break;
    }
    case "weather": {
      commit(saveWeather(data, f), t("weather.saved"));
      refreshWeather();
      break;
    }
    case "reminders": {
      const field = (k: string): string => text(f, k) ?? "";
      const next = setReminders(data, {
        enabled: f.get("enabled") !== null,
        time: field("time"),
        email: field("email"),
        host: field("host"),
        port: field("port"),
        user: field("user"),
        secure: field("secure"),
        from: field("from"),
      });
      if (next === undefined) notice.show(t("notice.remindersInvalid"));
      else commit(next, t("notice.remindersSaved"));
      break;
    }
    case "server": {
      const config = { url: text(f, "url") ?? "", token: text(f, "token") ?? "" };
      const session = new SyncSession(
        new RemoteBackend({ ...config, fetchFn: (url, init) => window.fetch(url, init) }),
      );
      void session.connect(data).then((r) => {
        if (r.kind === "failed") {
          reportSync(r.status);
          return;
        }
        const n = r.kind === "remote" ? r.data.plants.length : 0;
        if (r.kind === "remote" && !window.confirm(t("sync.replaceConfirm", { n }))) return;
        saveSyncConfig(window.localStorage, config);
        startSync(config);
        if (sync !== undefined) sync.revision = session.revision;
        if (r.kind === "remote") adopt(r.data, t("sync.loaded", { n }));
        else {
          notice.clear();
          render();
          notice.show(t("sync.uploaded"));
        }
      });
      break;
    }
    case "import": {
      const file = f.get("file");
      if (!(file instanceof File)) break;
      void file.text().then((content) => {
        const res = importData(content);
        if (res.data.plants.length === 0 && res.warnings.length > 0) {
          notice.show(t("notice.nothingImported", { reasons: importReasons(res.issues) }));
        } else if (window.confirm(t("confirm.replaceAll", { n: res.data.plants.length }))) {
          commit(
            res.data,
            t("notice.imported", {
              n: res.data.plants.length,
              warnings: importReasons(res.issues),
            }),
          );
        }
      });
      break;
    }
  }
};
root.addEventListener("submit", onSubmit);
homeRoot.addEventListener("submit", onSubmit);

const modalRoot = document.getElementById("modal-root");
if (modalRoot === null) throw new Error("missing #modal-root");
/** Opens Q-K0 on its own; the caller learns whether the home was saved. */
function askHome(done: (answered: boolean) => void): void {
  homeDraft = draftFromSettings(data.settings);
  homePending = askHomePending(data, done);
  render();
}

const plantModal = createPlantModal({
  root: modalRoot,
  data: () => data,
  today: () => today,
  commit: commitPlants,
  askHome,
});

const bulkRoot = document.getElementById("bulk-root");
if (bulkRoot === null) throw new Error("missing #bulk-root");
const bulkModal = createBulkModal({
  root: bulkRoot,
  data: () => data,
  today: () => today,
  commit: commitPlants,
  askHome,
});

render();
if (sync !== undefined) void sync.connect(data).then(reportConnected);
refreshWeather();
// The server keeps each answer for an hour; asking twice an hour only reads its cache.
window.setInterval(refreshWeather, 30 * 60_000);
