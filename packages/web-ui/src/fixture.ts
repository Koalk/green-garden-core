// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bundled fixture so the UI has something to show on first start: the ten pilot catalogue
 * entries (`pilot-data.ts`, generated from `catalogue-draft/`). PROVISIONAL: the room and
 * last-watered choices below are demo values; care values are the pilot's, mostly unverified.
 * Last-watered dates are relative to `today` so the plan has overdue, due and upcoming plants.
 */
import { formatDate, parseDate } from "@green-garden/engine";
import { DEFAULT_SPACE_ID, emptyData, type AppData, type Plant } from "@green-garden/storage";
import { PILOT } from "./pilot-data.ts";

/** Demo placement per pilot id: [room, days since last watered, pot diameter in cm]. */
const DEMO: Readonly<Record<string, readonly [string, number, number]>> = {
  "aloe-vera": ["Kitchen", 3, 12],
  "chlorophytum-comosum": ["Living room", 7, 14],
  "crassula-ovata": ["Kitchen", 10, 13],
  "dracaena-trifasciata": ["Bedroom", 9, 16],
  "epipremnum-aureum": ["Kitchen", 8, 12],
  "ficus-elastica": ["Living room", 8, 20],
  "monstera-deliciosa": ["Living room", 5, 24],
  "pilea-peperomioides": ["Bedroom", 6, 12],
  "spathiphyllum-wallisii": ["Living room", 6, 18],
  "zamioculcas-zamiifolia": ["Bedroom", 12, 15],
};

export function fixtureData(today: string): AppData {
  const t = parseDate(today);
  if (t === undefined) return emptyData();
  const rooms = [...new Set(Object.values(DEMO).map((d) => d[0]))].sort().map((name, i) => ({
    id: `r${i + 1}`,
    name,
    spaceId: DEFAULT_SPACE_ID,
  }));
  const plants: Plant[] = PILOT.map((r, i) => {
    const [room, daysAgo, potCm] = DEMO[r.id] ?? ["", 0, 15];
    const roomId = rooms.find((x) => x.name === room)?.id;
    return {
      id: `p${i + 1}`,
      spaceId: DEFAULT_SPACE_ID,
      name: r.name,
      species: r.scientificName,
      ...(roomId === undefined ? {} : { roomId }),
      style: r.style,
      intervalDays: r.intervalDays,
      dryTolDays: r.dryTolDays,
      wetTolDays: r.wetTolDays,
      restFactor: r.restFactor,
      lastWatered: formatDate(t - daysAgo),
      potDiameterCm: potCm,
      source: `catalogue pilot, not verified: ${r.confidence}`,
      logs: [],
    };
  });
  return { ...emptyData(), plants, rooms };
}
