// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FROZEN fixture catalogue for the name matcher tests. Do not edit it to follow the real
 * catalogue: the point is that new real entries never change these expectations. It has indoor and
 * garden plants, names in en, es and it, and the look-alike and ambiguity cases the matcher must
 * not resolve silently (rubber plant / fiddle-leaf fig, pothos / philodendron, geranium /
 * Pelargonium, the lavenders, the sago palm).
 */
import type { MatcherEntry } from "../src/index.ts";

interface Names {
  readonly en?: readonly string[];
  readonly es?: readonly string[];
  readonly it?: readonly string[];
}

function entry(
  id: string,
  scientificName: string,
  names: Names,
  extra: { readonly syn?: readonly string[]; readonly alike?: readonly string[] } = {},
): MatcherEntry {
  const common = [
    ...(names.en ?? []).map((name, i) => ({ lang: "en-GB", name, primary: i === 0 })),
    ...(names.es ?? []).map((name) => ({ lang: "es", name })),
    ...(names.it ?? []).map((name) => ({ lang: "it", name })),
  ];
  return {
    id,
    taxon: { scientificName },
    names: { common, synonyms: extra.syn ?? [] },
    lookAlikes: (extra.alike ?? []).map((species) => ({ species })),
  };
}

export const FIXTURE: readonly MatcherEntry[] = [
  entry(
    "dracaena-trifasciata",
    "Dracaena trifasciata",
    {
      en: ["Snake plant", "Mother-in-law's tongue"],
      es: ["Lengua de suegra", "Espada de San Jorge"],
      it: ["Lingua di suocera"],
    },
    { syn: ["Sansevieria trifasciata"] },
  ),
  entry(
    "dracaena-fragrans",
    "Dracaena fragrans",
    { en: ["Corn plant"], es: ["Palo de Brasil"], it: ["Tronchetto della felicità"] },
    { alike: ["dracaena-marginata"] },
  ),
  entry(
    "dracaena-marginata",
    "Dracaena marginata",
    { en: ["Madagascar dragon tree"], es: ["Drago de Madagascar"], it: ["Dracena marginata"] },
    { alike: ["dracaena-fragrans"] },
  ),
  entry(
    "epipremnum-aureum",
    "Epipremnum aureum",
    { en: ["Pothos", "Golden pothos", "Devil's ivy"], es: ["Potos"], it: ["Pothos"] },
    { syn: ["Scindapsus aureus"], alike: ["philodendron-hederaceum"] },
  ),
  entry(
    "philodendron-hederaceum",
    "Philodendron hederaceum",
    { en: ["Heartleaf philodendron"], es: ["Filodendro"], it: ["Filodendro"] },
    { alike: ["epipremnum-aureum"] },
  ),
  entry("scindapsus-pictus", "Scindapsus pictus", {
    en: ["Satin pothos", "Silver vine"],
    es: ["Potos plateado"],
    it: ["Pothos argentato"],
  }),
  entry("monstera-deliciosa", "Monstera deliciosa", {
    en: ["Swiss cheese plant", "Monstera"],
    es: ["Costilla de Adán", "Monstera"],
    it: ["Costola di Adamo", "Monstera"],
  }),
  entry(
    "ficus-elastica",
    "Ficus elastica",
    { en: ["Rubber plant", "Rubber fig"], es: ["Gomero"], it: ["Albero della gomma"] },
    { alike: ["ficus-lyrata"] },
  ),
  entry(
    "ficus-lyrata",
    "Ficus lyrata",
    { en: ["Fiddle-leaf fig"], es: ["Ficus lira"], it: ["Fico lira"] },
    { alike: ["ficus-elastica"] },
  ),
  entry("ficus-benjamina", "Ficus benjamina", {
    en: ["Weeping fig", "Benjamin fig"],
    es: ["Ficus llorón"],
    it: ["Ficus benjamino"],
  }),
  entry("ficus-carica", "Ficus carica", {
    en: ["Common fig"],
    es: ["Higuera"],
    it: ["Fico comune"],
  }),
  entry(
    "aloe-vera",
    "Aloe vera",
    { en: ["Aloe vera"], es: ["Sábila"], it: ["Aloe vera"] },
    {
      syn: ["Aloe barbadensis"],
    },
  ),
  entry("aloe-arborescens", "Aloe arborescens", {
    en: ["Krantz aloe"],
    es: ["Acíbar"],
    it: ["Aloe arborescens"],
  }),
  entry("chlorophytum-comosum", "Chlorophytum comosum", {
    en: ["Spider plant"],
    es: ["Cinta", "Mala madre"],
    it: ["Falangio", "Pianta ragno"],
  }),
  entry(
    "spathiphyllum-wallisii",
    "Spathiphyllum wallisii",
    { en: ["Peace lily"], es: ["Cuna de Moisés"], it: ["Spatifillo", "Giglio della pace"] },
    { alike: ["anthurium-andraeanum"] },
  ),
  entry(
    "anthurium-andraeanum",
    "Anthurium andraeanum",
    { en: ["Anthurium", "Flamingo flower"], es: ["Anturio"], it: ["Anthurium"] },
    { alike: ["spathiphyllum-wallisii"] },
  ),
  entry(
    "crassula-ovata",
    "Crassula ovata",
    { en: ["Jade plant"], es: ["Planta de jade", "Árbol de jade"], it: ["Pianta di giada"] },
    { alike: ["pilea-peperomioides"] },
  ),
  entry(
    "pilea-peperomioides",
    "Pilea peperomioides",
    {
      en: ["Chinese money plant", "Pancake plant"],
      es: ["Planta del dinero", "Pilea"],
      it: ["Pianta dei soldi", "Pilea"],
    },
    { alike: ["crassula-ovata"] },
  ),
  entry("pachira-aquatica", "Pachira aquatica", {
    en: ["Money tree"],
    es: ["Árbol del dinero"],
    it: ["Albero dei soldi"],
  }),
  entry("zamioculcas-zamiifolia", "Zamioculcas zamiifolia", {
    en: ["ZZ plant"],
    es: ["Zamioculca"],
    it: ["Zamioculcas"],
  }),
  entry("phalaenopsis", "Phalaenopsis", {
    en: ["Moth orchid"],
    es: ["Orquídea mariposa", "Orquídea"],
    it: ["Orchidea", "Falenopsi"],
  }),
  entry("schlumbergera-truncata", "Schlumbergera truncata", {
    en: ["Christmas cactus"],
    es: ["Cactus de Navidad"],
    it: ["Cactus di Natale"],
  }),
  entry("echinocactus-grusonii", "Echinocactus grusonii", {
    en: ["Golden barrel cactus"],
    es: ["Asiento de suegra"],
    it: ["Cuscino della suocera"],
  }),
  entry("opuntia-ficus-indica", "Opuntia ficus-indica", {
    en: ["Prickly pear"],
    es: ["Chumbera", "Nopal"],
    it: ["Fico d'India"],
  }),
  entry(
    "nephrolepis-exaltata",
    "Nephrolepis exaltata",
    { en: ["Boston fern"], es: ["Helecho de Boston"], it: ["Felce di Boston"] },
    { alike: ["asparagus-setaceus"] },
  ),
  entry(
    "asparagus-setaceus",
    "Asparagus setaceus",
    { en: ["Asparagus fern"], es: ["Helecho espárrago"], it: ["Asparago piumoso"] },
    { alike: ["nephrolepis-exaltata"] },
  ),
  entry("hedera-helix", "Hedera helix", {
    en: ["English ivy", "Common ivy"],
    es: ["Hiedra"],
    it: ["Edera"],
  }),
  entry(
    "chamaedorea-elegans",
    "Chamaedorea elegans",
    { en: ["Parlour palm"], es: ["Palma de salón"], it: ["Palma da salotto"] },
    { alike: ["cycas-revoluta"] },
  ),
  entry(
    "cycas-revoluta",
    "Cycas revoluta",
    { en: ["Sago palm"], es: ["Palma sagú"], it: ["Palma sago"] },
    { alike: ["chamaedorea-elegans", "dypsis-lutescens"] },
  ),
  entry(
    "dypsis-lutescens",
    "Dypsis lutescens",
    { en: ["Areca palm"], es: ["Palma areca"], it: ["Palma areca"] },
    { alike: ["cycas-revoluta"] },
  ),
  entry("goeppertia-makoyana", "Goeppertia makoyana", {
    en: ["Calathea", "Peacock plant"],
    es: ["Calatea"],
    it: ["Calatea"],
  }),
  entry("dieffenbachia-seguine", "Dieffenbachia seguine", {
    en: ["Dumb cane"],
    es: ["Dieffenbachia"],
    it: ["Dieffenbachia"],
  }),
  entry("hoya-carnosa", "Hoya carnosa", {
    en: ["Wax plant", "Hoya"],
    es: ["Flor de cera"],
    it: ["Fiore di cera"],
  }),
  entry("tradescantia-zebrina", "Tradescantia zebrina", {
    en: ["Wandering Jew", "Inch plant"],
    es: ["Amor de hombre"],
    it: ["Tradescantia"],
  }),
  // Garden plants: real ambiguity.
  entry("pelargonium-hortorum", "Pelargonium × hortorum", {
    en: ["Geranium", "Zonal geranium"],
    es: ["Geranio"],
    it: ["Geranio"],
  }),
  entry("geranium-sanguineum", "Geranium sanguineum", {
    en: ["Bloody cranesbill", "Hardy geranium"],
    // Spanish and Italian use "geranio" for the genus too, so the bare word is ambiguous there.
    es: ["Geranio", "Geranio silvestre"],
    it: ["Geranio", "Geranio sanguigno"],
  }),
  entry("lavandula-angustifolia", "Lavandula angustifolia", {
    en: ["English lavender"],
    es: ["Lavanda", "Espliego"],
    it: ["Lavanda"],
  }),
  entry("lavandula-stoechas", "Lavandula stoechas", {
    en: ["French lavender", "Spanish lavender"],
    es: ["Lavanda", "Cantueso"],
    it: ["Lavanda selvatica"],
  }),
  entry("rosa-hybrida", "Rosa × hybrida", { en: ["Rose"], es: ["Rosa", "Rosal"], it: ["Rosa"] }),
  entry("hibiscus-syriacus", "Hibiscus syriacus", {
    en: ["Rose of Sharon"],
    es: ["Hibisco"],
    it: ["Ibisco"],
  }),
  entry("hydrangea-macrophylla", "Hydrangea macrophylla", {
    en: ["Hydrangea", "Bigleaf hydrangea"],
    es: ["Hortensia"],
    it: ["Ortensia"],
  }),
  entry("buxus-sempervirens", "Buxus sempervirens", {
    en: ["Box", "Common box"],
    es: ["Boj"],
    it: ["Bosso"],
  }),
  entry("sempervivum-tectorum", "Sempervivum tectorum", {
    en: ["Houseleek"],
    es: ["Siempreviva"],
    it: ["Semprevivo"],
  }),
  entry("ocimum-basilicum", "Ocimum basilicum", {
    en: ["Basil"],
    es: ["Albahaca"],
    it: ["Basilico"],
  }),
  entry("rosmarinus-officinalis", "Rosmarinus officinalis", {
    en: ["Rosemary"],
    es: ["Romero"],
    it: ["Rosmarino"],
  }),
  entry("olea-europaea", "Olea europaea", { en: ["Olive tree"], es: ["Olivo"], it: ["Ulivo"] }),
  entry("citrus-limon", "Citrus limon", { en: ["Lemon tree"], es: ["Limonero"], it: ["Limone"] }),
];
