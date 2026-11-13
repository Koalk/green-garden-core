// SPDX-License-Identifier: AGPL-3.0-only

/** View models: turn app data and an engine plan into plain values the DOM layer prints. */
import {
  computeWindows,
  formatDate,
  parseDate,
  weekday,
  type LogOutcome,
  type PlanResult,
  type PlannedWatering,
  type PlantPlan,
  type Window,
} from "@green-garden/engine";
import { firstDayOfWeek, getLocale, weekdayName } from "@green-garden/i18n";
import {
  buildPlanInput,
  makePlan,
  spaceView,
  type AppData,
  type ImportIssue,
  type Plant,
} from "@green-garden/storage";
import { t } from "./text.ts";

export { buildPlanInput, makePlan };

function moved(n: number): string {
  if (n === 0) return "";
  return t(n < 0 ? "explain.earlier" : "explain.later", { n: Math.abs(n) });
}

/** PROVISIONAL: wording of the "why this plant moved" explanation. */
export function explain(w: PlannedWatering): string {
  const where = w.inWindow ? "" : t("explain.outsideWindow");
  const p = { moved: moved(w.movedDays), where };
  switch (w.reason) {
    case "on_ideal_day":
      return t("explain.onIdealDay");
    case "joined_group":
      return t("explain.joinedGroup", p);
    case "preferred_day":
      return t("explain.preferredDay", p);
    case "away_days":
      return t("explain.awayDays", p);
    case "pre_leave":
      return t("explain.preLeave", p);
    case "overdue":
      return t("explain.overdue", p);
  }
}

export interface WarningLink {
  readonly href: string;
  readonly label: string;
}

export interface Warning {
  readonly plantId: string;
  readonly text: string;
  readonly severity: 1 | 2 | 3;
  /** Where to look at the cause: the plant, the away days, the plan length. */
  readonly links: readonly WarningLink[];
}

/** Latest day the plant is known to have been watered (a `done` log or `lastWatered`). */
function lastWateredOf(plant: Plant | undefined): string | undefined {
  if (plant === undefined) return undefined;
  const days = [
    ...(plant.logs ?? []).filter((l) => l.outcome === "done").map((l) => l.date),
    ...(plant.lastWatered === undefined ? [] : [plant.lastWatered]),
  ].sort();
  return days.at(-1);
}

/** The first stretch of consecutive away days that has not ended before `from`. */
function awayStretch(data: AppData, from: string): { from: string; to: string } | undefined {
  const dates = [
    ...new Set((spaceView(data).spaces[0]?.awayDates ?? []).filter((d) => d >= from)),
  ].sort();
  const first = dates[0];
  if (first === undefined) return undefined;
  let end = first;
  for (const d of dates.slice(1)) {
    const prev = parseDate(end);
    if (prev === undefined || parseDate(d) !== prev + 1) break;
    end = d;
  }
  return { from: first, to: end };
}

/**
 * Plants whose outlook is worse than thriving, worst first. Every reason names its cause with the
 * date it comes from, and the warning links to where that cause can be seen.
 */
export function warnings(plan: PlanResult, data: AppData, today?: string): Warning[] {
  const plants = new Map(data.plants.map((p) => [p.id, p]));
  const planEnd = plan.days.at(-1)?.date;
  const out: Warning[] = [];
  for (const p of plan.plants) {
    if (p.outlook.severity === 0) continue;
    const plant = plants.get(p.plantId);
    const last = lastWateredOf(plant);
    const links: WarningLink[] = [{ href: "#plants", label: t("outlook.link.plant") }];
    const why = p.outlook.reasons
      .map((r) => {
        if (r === "gap_exceeds_band" && last !== undefined && today !== undefined) {
          const a = parseDate(last);
          const b = parseDate(today);
          if (a !== undefined && b !== undefined && b >= a)
            return t("outlook.since", { date: last, n: b - a });
        }
        if (r === "unserved" && planEnd !== undefined) {
          links.push({ href: "#settings", label: t("outlook.link.horizon") });
          return t("outlook.planEnd", { date: planEnd });
        }
        if (r === "away_days") {
          const stretch = awayStretch(data, today ?? last ?? "");
          if (stretch !== undefined) {
            links.push({ href: "#planning", label: t("outlook.link.away") });
            return t("outlook.awayStretch", stretch);
          }
        }
        return t(`outlook.reason.${r}`);
      })
      .join("; ");
    out.push({
      plantId: p.plantId,
      severity: p.outlook.severity,
      links,
      text: t("outlook.warning", {
        name: plant?.name ?? p.plantId,
        level: t(`outlook.level.${p.outlook.level}`),
        why,
      }),
    });
  }
  return out.sort((a, b) => b.severity - a.severity || (a.plantId < b.plantId ? -1 : 1));
}

export interface DayEntry {
  readonly plantId: string;
  readonly name: string;
  readonly room: string | undefined;
  readonly why: string;
  readonly moved: boolean;
  /** Outcomes already logged for this plant on `date` (it stays listed after skip / dry early). */
  readonly loggedToday: readonly LogOutcome[];
  /** Skipped or snoozed today: shown greyed out, no buttons, left out of "Water all". */
  readonly handled: boolean;
  /** Added by bulk add with "not sure" and never watered or logged: Today says "check the soil today". */
  readonly checkSoil?: boolean;
  /** Some of its care details are assumed (assumed margin): Today words it softly. */
  readonly around: boolean;
}

function wateringFor(plan: PlanResult, plantId: string, date: string): PlannedWatering | undefined {
  const pp: PlantPlan | undefined = plan.plants.find((p) => p.plantId === plantId);
  return pp?.waterings.find((w) => w.date === date);
}

/**
 * Who gets watered on `date` and why each one is on that day. `around` holds the plants whose window
 * has an uncertainty margin (`aroundPlants`); without it every entry reads exact.
 */
export function dayEntries(
  plan: PlanResult,
  data: AppData,
  date: string,
  around: ReadonlySet<string> = new Set(),
): DayEntry[] {
  const day = plan.days.find((d) => d.date === date);
  if (day === undefined) return [];
  const rooms = new Map(data.rooms.map((r) => [r.id, r.name]));
  const out: DayEntry[] = [];
  for (const id of day.plantIds) {
    const plant = data.plants.find((p) => p.id === id);
    const w = wateringFor(plan, id, date);
    const loggedToday = (plant?.logs ?? []).filter((l) => l.date === date).map((l) => l.outcome);
    out.push({
      plantId: id,
      name: plant?.name ?? id,
      room: plant?.roomId === undefined ? undefined : rooms.get(plant.roomId),
      why: w === undefined ? "" : explain(w),
      moved: w !== undefined && w.reason !== "on_ideal_day",
      loggedToday,
      // PROVISIONAL: skip and still wet close the plant for today; dry early keeps it due.
      handled: loggedToday.includes("skipped") || loggedToday.includes("still_wet"),
      around: around.has(id),
      ...(plant !== undefined &&
      plant.lastWatered === undefined &&
      (plant.logs ?? []).length === 0 &&
      plant.fieldSources?.lastWatered === "default"
        ? { checkSoil: true }
        : {}),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface CalendarCell {
  readonly date: string;
  /** Inside the plan's horizon. */
  readonly inPlan: boolean;
  readonly isToday: boolean;
  readonly away: boolean;
  readonly plantNames: readonly string[];
}

/** Weeks from the week of `today` to the end of the horizon; `weekStart` is the first day, 0 = Sunday. */
export function calendarWeeks(
  plan: PlanResult,
  data: AppData,
  today: string,
  horizonDays: number,
  weekStart = 1,
): CalendarCell[][] {
  const start = parseDate(today);
  if (start === undefined) return [];
  const end = start + Math.max(1, horizonDays) - 1;
  const firstCell = start - ((weekday(start) - weekStart + 7) % 7);
  const away = new Set([...(spaceView(data).settings.prefs.unavailableDates ?? [])]);
  const awayWeekdays = new Set(data.settings.prefs.unavailableWeekdays ?? []);
  const weeks: CalendarCell[][] = [];
  for (let d = firstCell; d <= end; d += 7) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = d + i;
      const date = formatDate(day);
      const inPlan = day >= start && day <= end;
      week.push({
        date,
        inPlan,
        isToday: day === start,
        away: away.has(date) || awayWeekdays.has(weekday(day)),
        plantNames: inPlan ? dayEntries(plan, data, date).map((e) => e.name) : [],
      });
    }
    weeks.push(week);
  }
  return weeks;
}

export interface PlantRow {
  readonly plant: Plant;
  readonly room: string | undefined;
  readonly nextWatering: string | undefined;
  readonly window: string | undefined;
  readonly overdueDays: number;
  /** The window carries an uncertainty margin: the card says "around every N days" and "about". */
  readonly around: boolean;
  /** Moved in the last 3 days while a window is open: the card says to look at the soil first. */
  readonly justMoved?: true;
}

/**
 * Care windows from the same plan input as the plan: start multipliers, latitude and the
 * uncertainty margin of assumed fields included, for the active space.
 */
export function windowsFor(data: AppData, today: string): readonly Window[] {
  return computeWindows(buildPlanInput(data, today)).windows;
}

/** Plants whose window has an uncertainty margin (the engine's `around` wording). */
export function aroundPlants(windows: readonly Pick<Window, "plantId" | "wording">[]): Set<string> {
  return new Set(windows.filter((w) => w.wording === "around").map((w) => w.plantId));
}

export function plantRows(
  plan: PlanResult,
  windows: readonly {
    plantId: string;
    earliest: string;
    latest: string;
    overdueDays: number;
    wording?: Window["wording"];
    justMoved?: true;
  }[],
  data: AppData,
): PlantRow[] {
  const rooms = new Map(data.rooms.map((r) => [r.id, r.name]));
  return data.plants.map((plant) => {
    const w = windows.find((x) => x.plantId === plant.id);
    const next = plan.plants.find((p) => p.plantId === plant.id)?.waterings[0]?.date;
    return {
      plant,
      room: plant.roomId === undefined ? undefined : rooms.get(plant.roomId),
      nextWatering: next,
      window: w === undefined ? undefined : `${w.earliest} to ${w.latest}`,
      overdueDays: w?.overdueDays ?? 0,
      around: w?.wording === "around",
      ...(w?.justMoved === true ? { justMoved: true as const } : {}),
    };
  });
}

/** The plant is due today or overdue: asking about "dry early" makes no sense then. */
export function isDueRow(r: PlantRow, today: string): boolean {
  return r.overdueDays > 0 || (r.nextWatering !== undefined && r.nextWatering <= today);
}

/** The plant card's care line, next watering and window, softened when some values are assumed. */
export function cardWords(r: PlantRow): { care: string; next: string; window: string } {
  const p = { style: styleLabel(r.plant.style), n: r.plant.intervalDays };
  const next = r.nextWatering;
  return {
    care: t(r.around ? "card.careLineAround" : "card.careLine", p),
    next:
      next === undefined
        ? t("card.next", { next: t("card.nonePlanned") })
        : t(r.around ? "card.nextAround" : "card.next", { next }),
    window:
      r.window === undefined
        ? t("common.none")
        : r.around
          ? t("card.windowAround", { window: r.window })
          : r.window,
  };
}

/** What Today says under a plant: the reason it is on the list, with "about" when values are assumed. */
export function todayLine(e: DayEntry): string {
  if (e.checkSoil === true) return t("today.checkSoil");
  return e.around ? t("today.around", { why: e.why }) : e.why;
}

export function styleLabel(style: Plant["style"]): string {
  return t(`style.${style}`);
}

/** Week start for the UI: the setting if set, else the locale's own. 0 = Sunday. */
export function weekStartOf(data: AppData, locale: string = getLocale()): number {
  return data.settings.weekStart ?? firstDayOfWeek(locale);
}

/** Column headers for a week starting on `weekStart`, in the active locale. */
export function weekHeaders(weekStart: number, locale: string = getLocale()): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayName((weekStart + i) % 7, locale, "short"));
}

/** Local calendar date of a JS Date as `YYYY-MM-DD` (browser shell only; the engine gets a string). */
export function localIsoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Pre-leave watering is on by default; only an explicit false turns it off. */
export function preLeaveOn(prefs: { readonly preLeaveWatering?: boolean }): boolean {
  return prefs.preLeaveWatering !== false;
}

/** Confirmation text for the two bulk buttons on Today; it names how many plants they touch. */
export function bulkConfirmText(kind: "water-all" | "cant-water", count: number): string {
  return t(kind === "water-all" ? "confirm.waterAll" : "confirm.cantWater", { n: count });
}

/** Import problems worded for the active locale, from their codes. */
export function importReasons(issues: readonly ImportIssue[]): string {
  return issues.map((i) => t(i.code, i.params)).join("; ");
}
