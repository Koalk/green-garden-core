// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan and calendar output shared by the web UI and the server: the plan of one space and the
 * watering days as an all-day-event `.ics` file (C13, RFC 5545). Kept here so the server's feed is the
 * same engine output as the UI's export, not a fork.
 */
import {
  formatDate,
  parseDate,
  planDays,
  type PlanInput,
  type PlanResult,
  type PlantInput,
  type WeatherDay,
} from "@green-garden/engine";
import {
  assumedMarginDays,
  homeLatitude,
  spaceView,
  startFactsFor,
  type AppData,
} from "./model.ts";

/**
 * The engine never reads a clock, so the caller hands it `today` here. `weather` is whatever the caller
 * has (observed rain credits outdoor plants, forecast rows only hint); core stores none.
 */
export function buildPlanInput(
  data: AppData,
  today: string,
  spaceId?: string,
  weather?: readonly WeatherDay[],
): PlanInput {
  const space = spaceView(data, spaceId);
  const latitude = homeLatitude(space.settings);
  return {
    today,
    hemisphere: space.settings.hemisphere,
    ...(latitude === undefined ? {} : { latitude }),
    ...(space.settings.country === undefined ? {} : { country: space.settings.country }),
    horizonDays: space.settings.horizonDays,
    ...(space.settings.climate === undefined ? {} : { climate: space.settings.climate }),
    ...(weather === undefined || weather.length === 0 ? {} : { weather }),
    // a plant the store load could not read is kept in the data but cannot be planned.
    plants: space.plants
      .filter((p) => p.invalid === undefined)
      .map((p) => {
        const uncertaintyDays = assumedMarginDays(p);
        // the start multipliers' facts go to the engine only when the interval is not the user's own.
        const rest = Object.fromEntries(
          Object.entries(p).filter(
            ([k]) => k !== "potDiameterCm" && k !== "potMaterial" && k !== "directSun",
          ),
        ) as PlantInput;
        // sun hours are per room indoors and per plant outdoors.
        const outdoors = p.placement !== undefined && p.placement !== "indoor";
        const facts = startFactsFor(space, p);
        // An interval the user typed themselves takes no indoor start facts, sun hours included.
        const sun = outdoors
          ? p.directSun
          : facts === undefined
            ? undefined
            : space.rooms.find((r) => r.id === p.roomId)?.directSun;
        const plant = {
          ...rest,
          ...facts,
          ...(sun === undefined ? {} : { directSun: sun }),
        };
        return uncertaintyDays === 0 ? plant : { ...plant, uncertaintyDays };
      }),
    prefs: space.settings.prefs,
    ...(space.pins === undefined ? {} : { pinned: space.pins }),
  };
}

/** The plan of one space (the active one by default). Spaces are never combined. */
export function makePlan(
  data: AppData,
  today: string,
  spaceId?: string,
  weather?: readonly WeatherDay[],
): PlanResult {
  return planDays(buildPlanInput(data, today, spaceId, weather));
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Bytes a code point takes in UTF-8. */
function utf8Length(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  return cp < 0x10000 ? 3 : 4;
}

/** Folds a content line at 75 octets, continuation lines start with one space. */
export function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = utf8Length(ch.codePointAt(0) ?? 0);
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out;
}

function compact(date: string): string {
  return date.replace(/-/g, "");
}

/**
 * One all-day event per planned watering day. `today` fixes DTSTAMP so the output is
 * deterministic; the UID is stable per date so re-importing updates instead of duplicating.
 * `summary` words the event title for a count of plants (the UI passes its translation).
 */
export function planToIcs(
  plan: PlanResult,
  data: AppData,
  today: string,
  summary: (plantCount: number) => string,
): string {
  const names = new Map(data.plants.map((p) => [p.id, p.name]));
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Green Garden Core//Watering plan//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const day of plan.days) {
    const start = parseDate(day.date);
    if (start === undefined) continue;
    const list = day.plantIds.map((id) => names.get(id) ?? id).sort();
    lines.push(
      "BEGIN:VEVENT",
      `UID:watering-${day.date}@green-garden.invalid`,
      `DTSTAMP:${compact(today)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(day.date)}`,
      `DTEND;VALUE=DATE:${compact(formatDate(start + 1))}`,
      `SUMMARY:${escapeText(summary(list.length))}`,
      `DESCRIPTION:${escapeText(list.join(", "))}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}
