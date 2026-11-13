// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Q-K0, the home question. Asked once, not per
 * plant: the country, then a region the person recognises, then at most two follow-ups. The answer is two
 * home settings, `climate` (summer water demand and rain pattern) and `winterMin` (RHS hardiness class).
 * No location is read or stored; a wrong guess only shifts intervals. The rows are judgement from AEMET
 * NT 37 and the Met Office rain pattern, `from knowledge, verify`; the es and it wording is a
 * machine draft for review.
 */
import type { Locale } from "./next.ts";

/** Mirrors the engine's `ClimateClass` and storage's `WinterMin`; this package imports neither. */
export type HomeClimate =
  "oceanic_wet" | "oceanic_dry" | "med_mild" | "mediterranean" | "semi_arid" | "arid" | "mountain";
export type HomeWinterMin = "H1c" | "H2" | "H3" | "H4" | "H5" | "H6";

export interface Home {
  readonly climate: HomeClimate;
  readonly winterMin: HomeWinterMin;
}

type Text = Readonly<Record<Locale, string>>;

export interface HomeFollowUpOption {
  readonly id: string;
  readonly label: Text;
  /** The suggestion this answer gives; absent when the answer only narrows (the Canaries). */
  readonly home?: Home;
}

export interface HomeFollowUp {
  readonly id: string;
  readonly question: Text;
  readonly options: readonly HomeFollowUpOption[];
}

export interface HomeRegion {
  readonly id: string;
  readonly country: "GB" | "ES";
  readonly label: Text;
  /** The suggestion without follow-ups; absent where the follow-ups are required. */
  readonly home?: Home;
  readonly followUps: readonly HomeFollowUp[];
  /** Required follow-ups answered in order, as `answer:answer`, to a suggestion. */
  readonly grid?: Readonly<Record<string, Home>>;
}

const h = (climate: HomeClimate, winterMin: HomeWinterMin): Home => ({ climate, winterMin });
const t = (en: string, es: string, it: string): Text => ({ "en-GB": en, es, it });
const yesNo = (yes: Home): readonly HomeFollowUpOption[] => [
  { id: "yes", label: t("Yes", "Sí", "Sì"), home: yes },
  { id: "no", label: t("No", "No", "No") },
];

// PROVISIONAL: every row is a guess by region.
export const HOME_REGIONS: readonly HomeRegion[] = [
  {
    id: "gb-scotland-west",
    country: "GB",
    label: t(
      "Scotland: west, north, Highlands and Islands",
      "Escocia: oeste, norte, Highlands e islas",
      "Scozia: ovest, nord, Highlands e isole",
    ),
    home: h("oceanic_wet", "H4"),
    followUps: [
      {
        id: "height",
        question: t(
          "Is the garden above about 300 m?",
          "¿Está el jardín por encima de unos 300 m?",
          "Il giardino è sopra i 300 m circa?",
        ),
        options: yesNo(h("mountain", "H5")).map((o) => ({
          ...o,
          id: o.id === "yes" ? "high" : "low",
        })),
      },
    ],
  },
  {
    id: "gb-scotland-east",
    country: "GB",
    label: t(
      "Scotland: east (Edinburgh, Aberdeen, Fife)",
      "Escocia: este (Edimburgo, Aberdeen, Fife)",
      "Scozia: est (Edimburgo, Aberdeen, Fife)",
    ),
    home: h("oceanic_dry", "H4"),
    followUps: [],
  },
  {
    id: "gb-wales-nw-sw",
    country: "GB",
    label: t(
      "Wales, Northern Ireland, north-west or south-west England",
      "Gales, Irlanda del Norte, noroeste o suroeste de Inglaterra",
      "Galles, Irlanda del Nord, Inghilterra nord-occidentale o sud-occidentale",
    ),
    home: h("oceanic_wet", "H4"),
    followUps: [
      {
        id: "cornwall",
        question: t(
          "Are you in Cornwall or on the Scilly coast?",
          "¿Estás en Cornualles o en la costa de las Sorlingas?",
          "Sei in Cornovaglia o sulla costa delle Scilly?",
        ),
        options: yesNo(h("oceanic_wet", "H3")),
      },
    ],
  },
  {
    id: "gb-england-east",
    country: "GB",
    label: t(
      "North-east England, Yorkshire, the Midlands, East Anglia, the south-east or London",
      "Noreste de Inglaterra, Yorkshire, Midlands, Anglia Oriental, sureste o Londres",
      "Inghilterra nord-orientale, Yorkshire, Midlands, East Anglia, sud-est o Londra",
    ),
    home: h("oceanic_dry", "H4"),
    followUps: [],
  },
  {
    id: "es-galicia-cantabrian",
    country: "ES",
    label: t(
      "Galicia, Asturias, Cantabria, País Vasco: the coast",
      "Galicia, Asturias, Cantabria, País Vasco: la costa",
      "Galizia, Asturie, Cantabria, Paesi Baschi: la costa",
    ),
    home: h("oceanic_wet", "H3"),
    followUps: [
      {
        id: "inland",
        question: t(
          "Inland or in the hills?",
          "¿Tierra adentro o en las colinas?",
          "Nell'entroterra o in collina?",
        ),
        options: yesNo(h("med_mild", "H4")).map((o) => ({
          ...o,
          id: o.id === "yes" ? "inland" : "coast",
        })),
      },
    ],
  },
  {
    id: "es-castilla-leon",
    country: "ES",
    label: t(
      "Castilla y León, La Rioja, inland Navarra, Soria, Teruel",
      "Castilla y León, La Rioja, Navarra interior, Soria, Teruel",
      "Castiglia e León, La Rioja, Navarra interna, Soria, Teruel",
    ),
    home: h("med_mild", "H5"),
    followUps: [
      {
        id: "mountain",
        question: t("Are you in the mountains?", "¿Estás en la montaña?", "Sei in montagna?"),
        options: yesNo(h("mountain", "H6")),
      },
    ],
  },
  {
    id: "es-madrid-clm-extremadura",
    country: "ES",
    label: t(
      "Madrid, Castilla-La Mancha, Extremadura",
      "Madrid, Castilla-La Mancha, Extremadura",
      "Madrid, Castiglia-La Mancia, Estremadura",
    ),
    home: h("mediterranean", "H5"),
    followUps: [
      {
        id: "dry",
        question: t(
          "South-east of La Mancha or in a dry valley?",
          "¿Sureste de La Mancha o en un valle seco?",
          "Sud-est della Mancia o in una valle secca?",
        ),
        options: yesNo(h("semi_arid", "H5")),
      },
    ],
  },
  {
    id: "es-aragon-ebro",
    country: "ES",
    label: t(
      "Aragón (Ebro valley), Lleida",
      "Aragón (valle del Ebro), Lleida",
      "Aragona (valle dell'Ebro), Lleida",
    ),
    home: h("semi_arid", "H5"),
    followUps: [
      {
        id: "pyrenees",
        question: t("Are you in the Pyrenees?", "¿Estás en los Pirineos?", "Sei sui Pirenei?"),
        options: yesNo(h("mountain", "H6")),
      },
    ],
  },
  {
    id: "es-coast-east-south",
    country: "ES",
    label: t(
      "Catalonia coast, Valencia, Andalusia coast",
      "Costa de Cataluña, Valencia, costa de Andalucía",
      "Costa della Catalogna, Valencia, costa dell'Andalusia",
    ),
    home: h("mediterranean", "H3"),
    followUps: [
      {
        id: "malaga-cadiz",
        question: t(
          "Is it the coast from Málaga to Cádiz?",
          "¿Es la costa de Málaga a Cádiz?",
          "È la costa da Malaga a Cadice?",
        ),
        options: yesNo(h("mediterranean", "H2")),
      },
    ],
  },
  {
    id: "es-murcia-almeria-alicante",
    country: "ES",
    label: t(
      "Murcia, Almería, south Alicante",
      "Murcia, Almería, sur de Alicante",
      "Murcia, Almería, sud di Alicante",
    ),
    home: h("semi_arid", "H3"),
    followUps: [
      {
        id: "coast",
        question: t(
          "Right on the coast near Almería or Cabo de Gata?",
          "¿Justo en la costa, cerca de Almería o del Cabo de Gata?",
          "Proprio sulla costa vicino ad Almería o a Capo de Gata?",
        ),
        options: yesNo(h("arid", "H2")).map((o) => ({
          ...o,
          id: o.id === "yes" ? "coast" : "inland",
        })),
      },
    ],
  },
  {
    id: "es-andalusia-inland",
    country: "ES",
    label: t(
      "Inland Andalusia (Seville, Córdoba, Jaén, Granada)",
      "Andalucía interior (Sevilla, Córdoba, Jaén, Granada)",
      "Andalusia interna (Siviglia, Cordova, Jaén, Granada)",
    ),
    home: h("mediterranean", "H4"),
    followUps: [
      {
        id: "mountain",
        question: t(
          "Sierra Nevada or above 1,000 m?",
          "¿Sierra Nevada o por encima de 1.000 m?",
          "Sierra Nevada o sopra i 1.000 m?",
        ),
        options: yesNo(h("mountain", "H5")).map((o) => ({
          ...o,
          id: o.id === "yes" ? "mountain" : "no",
        })),
      },
    ],
  },
  {
    id: "es-mallorca-menorca",
    country: "ES",
    label: t("Mallorca, Menorca", "Mallorca, Menorca", "Maiorca, Minorca"),
    home: h("mediterranean", "H3"),
    followUps: [
      {
        id: "southwest",
        question: t("South-west Mallorca?", "¿Suroeste de Mallorca?", "Sud-ovest di Maiorca?"),
        options: yesNo(h("semi_arid", "H3")),
      },
    ],
  },
  {
    id: "es-ibiza",
    country: "ES",
    label: t("Ibiza, Formentera", "Ibiza, Formentera", "Ibiza, Formentera"),
    home: h("semi_arid", "H3"),
    followUps: [],
  },
  {
    id: "es-lanzarote-fuerteventura",
    country: "ES",
    label: t("Lanzarote, Fuerteventura", "Lanzarote, Fuerteventura", "Lanzarote, Fuerteventura"),
    home: h("arid", "H1c"),
    followUps: [],
  },
  {
    id: "es-canary-high-islands",
    country: "ES",
    label: t(
      "Tenerife, Gran Canaria, La Palma, La Gomera, El Hierro",
      "Tenerife, Gran Canaria, La Palma, La Gomera, El Hierro",
      "Tenerife, Gran Canaria, La Palma, La Gomera, El Hierro",
    ),
    followUps: [
      {
        id: "side",
        question: t(
          "Which side of the island: north (facing the trade winds) or south?",
          "¿En qué lado de la isla: norte (hacia los alisios) o sur?",
          "Su quale lato dell'isola: nord (verso gli alisei) o sud?",
        ),
        options: [
          { id: "north", label: t("North", "Norte", "Nord") },
          { id: "south", label: t("South", "Sur", "Sud") },
        ],
      },
      {
        id: "height",
        question: t(
          "How high: the coast, the middle slopes (300 to 1,200 m) or above?",
          "¿A qué altura: la costa, las medianías (300 a 1.200 m) o más arriba?",
          "A che altezza: la costa, i versanti medi (300-1.200 m) o più in alto?",
        ),
        options: [
          { id: "coast", label: t("Coast", "Costa", "Costa") },
          { id: "middle", label: t("Middle slopes", "Medianías", "Versanti medi") },
          { id: "high", label: t("Above 1,200 m", "Por encima de 1.200 m", "Sopra i 1.200 m") },
        ],
      },
    ],
    grid: {
      "north:coast": h("mediterranean", "H1c"),
      "north:middle": h("med_mild", "H2"),
      "south:coast": h("arid", "H1c"),
      "south:middle": h("semi_arid", "H2"),
      "north:high": h("mountain", "H4"),
      "south:high": h("mountain", "H4"),
    },
  },
];

/** The follow-up questions of a region, in the order to ask them. */
export function followUpFor(regionId: string): readonly HomeFollowUp[] {
  return HOME_REGIONS.find((r) => r.id === regionId)?.followUps ?? [];
}

/**
 * The suggested `climate` and `winterMin` for a region and its follow-up answers (option ids, in order).
 * A region with a grid needs every answer; otherwise the first answer that carries a suggestion wins and
 * anything else gives the region's own. Unknown region, or a grid not fully answered: undefined.
 */
export function homeFor(regionId: string, ...answers: readonly string[]): Home | undefined {
  const region = HOME_REGIONS.find((r) => r.id === regionId);
  if (region === undefined) return undefined;
  if (region.grid !== undefined) return region.grid[answers.join(":")];
  const first = answers[0];
  const picked = region.followUps[0]?.options.find((o) => o.id === first)?.home;
  return picked ?? region.home;
}
