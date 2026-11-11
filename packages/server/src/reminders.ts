// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure core of email reminders (D-27, D-08): what is due for whom at what time, with the stop
 * rule. No clock, no files, no mail: the scheduler and the transport sit around it.
 *
 * One email per watering day. A plant stops being reminded after `STOP_AFTER` reminders that nobody
 * actioned; any log (done, skipped, still wet, dry early) dated on or after a reminder actions it, which
 * resumes reminders for that plant.
 */
import { makePlan, type AppData, type Plant } from "@green-garden/storage";

export const STOP_AFTER = 3;

export interface ReminderState {
  /** Plant id to the dates reminders were sent for it. */
  readonly sent: Readonly<Record<string, readonly string[]>>;
  /** The day an email last went out; at most one a day. */
  readonly lastSentDate?: string;
}

export interface DueReminder {
  readonly plantIds: readonly string[];
  readonly names: readonly string[];
}

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Latest date the plant was acted on: its last watering or any log entry. */
function lastActioned(p: Plant): string {
  return [p.lastWatered ?? "", ...(p.logs ?? []).map((l) => l.date)].reduce(
    (a, b) => (b > a ? b : a),
    "",
  );
}

function unactioned(p: Plant, state: ReminderState): number {
  const last = lastActioned(p);
  return (state.sent[p.id] ?? []).filter((d) => d > last).length;
}

/** The reminder to send now, or undefined when there is nothing to send. `minutes` is local time of day. */
export function dueReminder(input: {
  readonly data: AppData;
  readonly today: string;
  readonly minutes: number;
  readonly state: ReminderState;
}): DueReminder | undefined {
  const { data, today, minutes, state } = input;
  const settings = data.settings.reminders;
  if (settings === undefined || !settings.enabled) return undefined;
  if (minutes < minutesOfDay(settings.time) || state.lastSentDate === today) return undefined;
  const day = makePlan(data, today).days.find((d) => d.date === today);
  if (day === undefined) return undefined;
  const byId = new Map(data.plants.map((p) => [p.id, p]));
  const plants = day.plantIds
    .map((id) => byId.get(id))
    .filter((p): p is Plant => p !== undefined)
    .filter((p) => !(p.logs ?? []).some((l) => l.date === today))
    .filter((p) => unactioned(p, state) < STOP_AFTER);
  if (plants.length === 0) return undefined;
  return { plantIds: plants.map((p) => p.id), names: plants.map((p) => p.name) };
}

/** The state after an email for `plantIds` went out on `today`. */
export function recordSent(
  state: ReminderState,
  plantIds: readonly string[],
  today: string,
): ReminderState {
  const sent: Record<string, readonly string[]> = { ...state.sent };
  for (const id of plantIds) {
    const dates = sent[id] ?? [];
    if (!dates.includes(today)) sent[id] = [...dates, today];
  }
  return { sent, lastSentDate: today };
}
