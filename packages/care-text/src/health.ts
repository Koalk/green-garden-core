// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The health check prompt: a text built from what the app already knows about a plant, copied to
 * the clipboard and pasted into an AI chat or a search. Nothing is sent anywhere. Fields that are not known
 * are left out, never printed as "unknown", and the text never carries coordinates (only the climate in
 * words and the country). Pure: the caller hands in `today`, the translator and the lookups it owns
 * (catalogue names, how long the plant has been owned, the open "!" items).
 */
import { parseDate, type LogOutcome } from "@green-garden/engine";
import { formatDate, type Translate } from "@green-garden/i18n";
import type { AppData } from "@green-garden/storage";

export interface HealthCheckFacts {
  readonly commonName?: string;
  readonly scientificName?: string;
  readonly genus?: string;
  readonly family?: string;
  /** Already worded: "indoors, in the Kitchen", "in a pot outside", "in the ground". */
  readonly place: string;
  readonly light?: string;
  readonly pot?: string;
  readonly had?: string;
  readonly nowMonth: string;
  readonly nowSeason: string;
  readonly climate?: string;
  readonly country?: string;
  readonly intervalDays: number;
  readonly recent: readonly string[];
  readonly rainMm?: number;
  readonly openItems: readonly string[];
}

/** What the caller supplies beyond `data`. */
export interface HealthCheckExtra {
  readonly locale: string;
  readonly commonName?: string;
  readonly scientificName?: string;
  readonly family?: string;
  /** Fallback day when the plant has no `addedOn` (older data); treated as a guess. */
  readonly hadSince?: string;
  /** The "!" items still open, already worded. */
  readonly openItems?: readonly string[];
}

const SEASONS = ["winter", "spring", "summer", "autumn"] as const;

/** Meteorological seasons by month (1 to 12); the southern hemisphere is six months apart. */
function seasonOf(month: number, south: boolean): (typeof SEASONS)[number] {
  const m = (south ? month + 6 : month) % 12; // Dec, Jan, Feb = 0, 1, 2: winter
  return SEASONS[Math.floor(m / 3)] ?? "winter";
}

const RECENT_OUTCOMES: readonly LogOutcome[] = ["done", "skipped", "still_wet", "dry_early"];

export function healthCheckFacts(
  tr: Translate,
  data: AppData,
  plantId: string,
  today: string,
  extra: HealthCheckExtra,
): HealthCheckFacts | undefined {
  const plant = data.plants.find((p) => p.id === plantId);
  const day = parseDate(today);
  if (plant === undefined || day === undefined) return undefined;
  const room = data.rooms.find((r) => r.id === plant.roomId);
  const month = Number(today.slice(5, 7));
  const south = data.settings.hemisphere === "south";
  const scientificName = extra.scientificName ?? plant.species;
  const genus = scientificName?.trim().split(/\s+/)[0];
  const placement = plant.placement ?? "indoor";
  const light = room?.light === undefined ? undefined : tr(`light.${room.light}`);
  const place =
    placement === "ground"
      ? tr("healthcheck.place.ground")
      : placement === "outdoor_pot"
        ? tr("healthcheck.place.outdoorPot")
        : room === undefined
          ? tr("healthcheck.place.indoors")
          : tr("healthcheck.place.indoorsRoom", { room: room.name });
  const potBits = [
    plant.potMaterial === undefined ? undefined : tr(`healthcheck.pot.${plant.potMaterial}`),
    plant.potDiameterCm === undefined ? undefined : `${String(plant.potDiameterCm)} cm`,
  ].filter((x): x is string => x !== undefined);
  const hadDay = plant.addedOn ?? extra.hadSince;
  const owned = hadDay === undefined ? undefined : parseDate(hadDay);
  const days = owned === undefined ? undefined : day - owned;
  // A guessed date under a week old says nothing useful ("had it for 2 days" for an old plant).
  const guessed =
    plant.addedOn === undefined ? extra.hadSince !== undefined : plant.addedOnEstimated === true;
  const had =
    days === undefined || days < 0 || (guessed && days < 7)
      ? undefined
      : days < 60
        ? tr("healthcheck.hadDays", { n: Math.max(days, 1) })
        : days < 730
          ? tr("healthcheck.hadMonths", { n: Math.round(days / 30.44) })
          : tr("healthcheck.hadYears", { n: Math.round(days / 365.25) });
  const rainMm =
    placement === "indoor"
      ? 0
      : Math.round(
          (plant.logs ?? [])
            .filter((l) => l.outcome === "rain" && l.mm !== undefined)
            .filter((l) => {
              const d = parseDate(l.date);
              return d !== undefined && d <= day && d > day - 7;
            })
            .reduce((sum, l) => sum + (l.mm ?? 0), 0),
        );
  const recent = (plant.logs ?? [])
    .filter((l) => RECENT_OUTCOMES.includes(l.outcome) && parseDate(l.date) !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 3)
    .map((l) => `${l.date} ${tr(`outcome.name.${l.outcome}`)}`);
  const { climate, country } = data.settings;
  return {
    ...(extra.commonName === undefined ? {} : { commonName: extra.commonName }),
    ...(scientificName === undefined ? {} : { scientificName }),
    ...(genus === undefined ? {} : { genus }),
    ...(extra.family === undefined ? {} : { family: extra.family }),
    place,
    ...(light === undefined ? {} : { light }),
    ...(potBits.length === 0 ? {} : { pot: potBits.join(", ") }),
    ...(had === undefined ? {} : { had }),
    nowMonth: formatDate(today, extra.locale, { month: "long" }),
    nowSeason: tr(`healthcheck.season.${seasonOf(month, south)}`),
    ...(climate === undefined ? {} : { climate: tr(`home.climate.${climate}`) }),
    ...(country === undefined ? {} : { country: tr(`home.country.${country}`) }),
    intervalDays: plant.intervalDays,
    recent,
    ...(rainMm > 0 ? { rainMm } : {}),
    openItems: extra.openItems ?? [],
  };
}

function identity(f: HealthCheckFacts): string | undefined {
  if (f.commonName !== undefined && f.scientificName !== undefined) {
    return f.commonName === f.scientificName
      ? f.scientificName
      : `${f.commonName} (${f.scientificName})`;
  }
  return f.commonName ?? f.scientificName;
}

/** The long prompt for an AI chat. `symptoms` fills the last line when typed; otherwise a placeholder. */
export function healthCheckText(tr: Translate, f: HealthCheckFacts, symptoms?: string): string {
  const typed = symptoms?.trim();
  const who = identity(f);
  const where = [f.climate, f.country].filter((x): x is string => x !== undefined);
  const lines: (string | undefined)[] = [
    tr("healthcheck.intro"),
    who === undefined ? undefined : tr("healthcheck.plant", { who }),
    f.genus === undefined ? undefined : tr("healthcheck.genus", { genus: f.genus }),
    f.family === undefined ? undefined : tr("healthcheck.family", { family: f.family }),
    tr("healthcheck.place", { place: f.place }),
    f.light === undefined ? undefined : tr("healthcheck.light", { light: f.light }),
    f.pot === undefined ? undefined : tr("healthcheck.pot", { pot: f.pot }),
    f.had === undefined ? undefined : tr("healthcheck.had", { had: f.had }),
    tr("healthcheck.now", { month: f.nowMonth, season: f.nowSeason }),
    where.length === 0 ? undefined : tr("healthcheck.climate", { climate: where.join(", ") }),
    tr("healthcheck.watering", { n: f.intervalDays }),
    f.recent.length === 0 ? undefined : tr("healthcheck.recent", { list: f.recent.join("; ") }),
    f.rainMm === undefined ? undefined : tr("healthcheck.rain", { mm: f.rainMm }),
    f.openItems.length === 0 ? undefined : tr("healthcheck.open", { list: f.openItems.join("; ") }),
    tr("healthcheck.symptoms", {
      text: typed === undefined || typed === "" ? `{${tr("healthcheck.symptomsHint")}}` : typed,
    }),
    tr("healthcheck.ask"),
  ];
  return lines.filter((l): l is string => l !== undefined).join("\n");
}

/** A short text for a web search: the names, then the symptoms (or a word standing for them). */
export function healthSearchText(tr: Translate, f: HealthCheckFacts, symptoms?: string): string {
  const typed = symptoms?.trim();
  return [
    f.scientificName,
    f.commonName === f.scientificName ? undefined : f.commonName,
    typed === undefined || typed === "" ? tr("healthcheck.searchSymptoms") : typed,
  ]
    .filter((x): x is string => x !== undefined && x !== "")
    .join(" ");
}
