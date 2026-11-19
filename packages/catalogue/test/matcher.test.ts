// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createNameMatcher,
  matchNames,
  type MatcherEntry,
  type MatchReason,
  type Verdict,
} from "../src/index.ts";
import { FIXTURE } from "./fixture-catalogue.ts";
import { LANG_FIXTURE } from "./fixture-languages.ts";

/** One expectation. `top` is the first candidate; `has` ids must all be among the candidates. */
interface Row {
  readonly input: string;
  readonly locale?: string;
  readonly verdict: Verdict;
  readonly top?: string;
  readonly has?: readonly string[];
  readonly reason?: MatchReason;
}

const conf = (input: string, top: string, extra: Partial<Row> = {}): Row => ({
  input,
  verdict: "confident",
  top,
  ...extra,
});
const pick = (input: string, has: readonly string[], extra: Partial<Row> = {}): Row => ({
  input,
  verdict: "choose",
  has,
  ...extra,
});
const none = (input: string, extra: Partial<Row> = {}): Row => ({
  input,
  verdict: "none",
  ...extra,
});

const SNAKE = "dracaena-trifasciata";
const MONSTERA = "monstera-deliciosa";
const POTHOS = "epipremnum-aureum";
const PHILO = "philodendron-hederaceum";

const ROWS: readonly Row[] = [
  // Exact names, case, accents, plurals, spacing
  conf("Snake plant", SNAKE, { reason: "exact" }),
  conf("SNAKE PLANT", SNAKE, { reason: "exact" }),
  conf("  snake   plant ", SNAKE),
  conf("snake plants", SNAKE),
  conf("snakeplant", SNAKE),
  conf("Dracaena trifasciata", SNAKE, { reason: "exact" }),
  conf("Monstera deliciosa", MONSTERA, { reason: "exact" }),
  conf("Mother-in-law's tongue", SNAKE),
  conf("mother in law tongue", SNAKE),
  // Synonyms and other languages in an English locale
  conf("Sansevieria trifasciata", SNAKE, { reason: "alias" }),
  conf("Sansevieria", SNAKE),
  conf("Lengua de suegra", SNAKE, { reason: "common" }),
  conf("Lengua de suegra", SNAKE, { locale: "es", reason: "exact" }),
  conf("lengua suegra", SNAKE, { locale: "es" }),
  conf("Lingua di suocera", SNAKE, { locale: "it" }),
  // Typos
  conf("Dracena trifasciata", SNAKE, { reason: "typo" }),
  conf("snake plnat", SNAKE, { reason: "typo" }),
  conf("monstra deliciosa", MONSTERA, { reason: "typo" }),
  conf("monstera delisiosa", MONSTERA),
  conf("lengua de suergra", SNAKE, { locale: "es" }),
  conf("rosmary", "rosmarinus-officinalis"),
  conf("basel", "ocimum-basilicum"),
  pick("parlor palm", ["chamaedorea-elegans"], { top: "chamaedorea-elegans" }),
  pick("ficus lirata", ["ficus-lyrata"], { top: "ficus-lyrata" }),
  pick("spatifilo", ["spathiphyllum-wallisii"], { top: "spathiphyllum-wallisii", locale: "it" }),
  conf("orquidea", "phalaenopsis", { locale: "es" }),
  conf("falenopsis", "phalaenopsis", { locale: "it" }),
  // Half names
  conf("snake", SNAKE, { reason: "partial" }),
  conf("swiss cheese", MONSTERA),
  conf("deliciosa", MONSTERA),
  conf("orchid", "phalaenopsis"),
  conf("olive", "olea-europaea"),
  conf("lemon", "citrus-limon"),
  conf("rose", "rosa-hybrida"),
  // Genus only
  conf("hedera", "hedera-helix"),
  conf("olea", "olea-europaea", { reason: "genus" }),
  conf("Ocimum", "ocimum-basilicum", { reason: "genus" }),
  conf("pelargonium", "pelargonium-hortorum", { reason: "genus" }),
  conf("opuntia", "opuntia-ficus-indica"),
  // Word order, extra words, counts, list markers
  conf("plant snake", SNAKE, { reason: "word-order" }),
  conf("big kitchen snake plant", SNAKE),
  conf("my snake plant", SNAKE),
  pick("planta de jade grande", ["crassula-ovata"], { top: "crassula-ovata", locale: "es" }),
  conf("la mia monstera in salotto", MONSTERA, { locale: "it" }),
  conf("spotty monstera", MONSTERA),
  conf("2 snake plants", SNAKE),
  pick("3x pothos", [POTHOS], { top: POTHOS }),
  pick("pothos x2", [POTHOS], { top: POTHOS }),
  pick("- pothos", [POTHOS], { top: POTHOS }),
  conf("1. snake plant", SNAKE),
  // Spanish and Italian common names
  conf("Costilla de Adán", MONSTERA, { locale: "es" }),
  conf("costilla de adan", MONSTERA, { locale: "es" }),
  pick("Palma de salón", ["chamaedorea-elegans"], { top: "chamaedorea-elegans", locale: "es" }),
  pick("palma sagu", ["cycas-revoluta"], { top: "cycas-revoluta", locale: "es" }),
  conf("cactus de navidad", "schlumbergera-truncata", { locale: "es" }),
  conf("hiedra", "hedera-helix", { locale: "es" }),
  conf("edera", "hedera-helix", { locale: "it" }),
  conf("orquídeas", "phalaenopsis", { locale: "es" }),
  conf("orchidea", "phalaenopsis", { locale: "it" }),
  pick("cuna de moises", ["spathiphyllum-wallisii"], {
    top: "spathiphyllum-wallisii",
    locale: "es",
  }),
  pick("giglio della pace", ["spathiphyllum-wallisii"], {
    top: "spathiphyllum-wallisii",
    locale: "it",
  }),
  conf("pianta ragno", "chlorophytum-comosum", { locale: "it" }),
  conf("mala madre", "chlorophytum-comosum", { locale: "es" }),
  pick("pianta di giada", ["crassula-ovata"], { top: "crassula-ovata", locale: "it" }),
  pick("árbol de jade", ["crassula-ovata"], { top: "crassula-ovata", locale: "es" }),
  pick("planta del dinero", ["pilea-peperomioides"], { top: "pilea-peperomioides", locale: "es" }),
  conf("arbol del dinero", "pachira-aquatica", { locale: "es" }),
  pick("pianta dei soldi", ["pilea-peperomioides"], { top: "pilea-peperomioides", locale: "it" }),
  conf("albero dei soldi", "pachira-aquatica", { locale: "it" }),
  pick("felce di boston", ["nephrolepis-exaltata"], { top: "nephrolepis-exaltata", locale: "it" }),
  conf("albahaca", "ocimum-basilicum", { locale: "es" }),
  conf("basilico", "ocimum-basilicum", { locale: "it" }),
  conf("limonero", "citrus-limon", { locale: "es" }),
  conf("ulivo", "olea-europaea", { locale: "it" }),
  conf("higuera", "ficus-carica", { locale: "es" }),
  conf("hortensias", "hydrangea-macrophylla", { locale: "es" }),
  conf("houseleek", "sempervivum-tectorum"),
  conf("house leek", "sempervivum-tectorum"),
  conf("siempreviva", "sempervivum-tectorum", { locale: "es" }),
  // Exact names of plants with no look-alike stay confident
  pick("chinese money plant", ["pilea-peperomioides"], { top: "pilea-peperomioides" }),
  pick("asparagus fern", ["asparagus-setaceus"], { top: "asparagus-setaceus" }),
  pick("boston fern", ["nephrolepis-exaltata"], { top: "nephrolepis-exaltata" }),
  pick("corn plant", ["dracaena-fragrans"], { top: "dracaena-fragrans" }),
  conf("aloe vera", "aloe-vera"),
  conf("aloevera", "aloe-vera"),
  conf("aloe vera plant", "aloe-vera"),
  conf("krantz aloe", "aloe-arborescens"),
  conf("english lavender", "lavandula-angustifolia"),
  conf("lavandula stoechas", "lavandula-stoechas"),
  conf("bigleaf hydrangea", "hydrangea-macrophylla"),
  conf("big leaf hydrangea", "hydrangea-macrophylla"),
  // A full name that has a look-alike entry is a choose too
  pick("pothos", [POTHOS, PHILO], { top: POTHOS }),
  pick("golden pothos", [POTHOS, PHILO], { top: POTHOS }),
  pick("pothus", [POTHOS, PHILO], { top: POTHOS }),
  pick("epipremnum aureum", [POTHOS, PHILO], { top: POTHOS }),
  pick("heartleaf philodendron", [PHILO, POTHOS], { top: PHILO }),
  pick("rubber plant", ["ficus-elastica", "ficus-lyrata"], { top: "ficus-elastica" }),
  pick("fiddle leaf fig", ["ficus-lyrata", "ficus-elastica"], { top: "ficus-lyrata" }),
  pick("jade plant", ["crassula-ovata", "pilea-peperomioides"], { top: "crassula-ovata" }),
  pick("sago palm", ["cycas-revoluta", "chamaedorea-elegans"], { top: "cycas-revoluta" }),
  pick("filodendro", [PHILO, POTHOS], { top: PHILO, locale: "es" }),
  // Look-alikes: never a silent confident pick when the input is incomplete
  pick("philodendron", [PHILO, POTHOS], { top: PHILO }),
  pick("epipremnum", [POTHOS, PHILO], { top: POTHOS }),
  pick("heartleaf", [PHILO, POTHOS], { top: PHILO }),
  pick("rubber", ["ficus-elastica", "ficus-lyrata"], { top: "ficus-elastica" }),
  pick("fiddle fig", ["ficus-lyrata", "ficus-elastica"], { top: "ficus-lyrata" }),
  pick("jade", ["crassula-ovata", "pilea-peperomioides"], { top: "crassula-ovata" }),
  pick("sago", ["cycas-revoluta", "chamaedorea-elegans"], { top: "cycas-revoluta" }),
  pick("dragon tree", ["dracaena-marginata", "dracaena-fragrans"], { top: "dracaena-marginata" }),
  pick("peace", ["spathiphyllum-wallisii", "anthurium-andraeanum"]),
  // Several candidates, none clearly better
  pick("money plant", ["pachira-aquatica", "pilea-peperomioides"]),
  pick("money", ["pachira-aquatica", "pilea-peperomioides"]),
  pick("dinero", ["pachira-aquatica", "pilea-peperomioides"], { locale: "es" }),
  pick("soldi", ["pachira-aquatica", "pilea-peperomioides"], { locale: "it" }),
  pick("ficus", ["ficus-elastica", "ficus-lyrata", "ficus-benjamina", "ficus-carica"]),
  pick("fig", ["ficus-carica", "ficus-benjamina"]),
  pick("palm", ["chamaedorea-elegans", "cycas-revoluta", "dypsis-lutescens"]),
  pick("palma", ["chamaedorea-elegans", "cycas-revoluta"], { locale: "es" }),
  pick("fern", ["nephrolepis-exaltata", "asparagus-setaceus"]),
  pick("helecho", ["nephrolepis-exaltata", "asparagus-setaceus"], { locale: "es" }),
  pick("cactus", ["schlumbergera-truncata", "echinocactus-grusonii"]),
  pick("xmas cactus", ["schlumbergera-truncata"]),
  pick("dracaena", [SNAKE, "dracaena-fragrans", "dracaena-marginata"]),
  pick("aloe", ["aloe-vera", "aloe-arborescens"]),
  pick("pothos plant leaf mix", [POTHOS]),
  // Garden ambiguity
  pick("geranium", ["pelargonium-hortorum", "geranium-sanguineum"], {
    top: "pelargonium-hortorum",
  }),
  pick("geranio", ["pelargonium-hortorum", "geranium-sanguineum"], { locale: "es" }),
  pick("lavender", ["lavandula-angustifolia", "lavandula-stoechas"]),
  pick("lavanda", ["lavandula-angustifolia", "lavandula-stoechas"], { locale: "es" }),
  pick("lavandula", ["lavandula-angustifolia", "lavandula-stoechas"]),
  // Not in the catalogue
  none("xyzzy"),
  none("asdfghjkl"),
  none("tomato"),
  none("banana tree"),
  none("plant"),
  none("my plant"),
  none("tree"),
  none("3"),
  none("a"),
  none("cat"),
];

describe("matchNames: table of realistic inputs", () => {
  it("has at least 60 rows", () => {
    assert.ok(ROWS.length >= 60, String(ROWS.length));
  });

  for (const row of ROWS) {
    const where = `${row.input} [${row.locale ?? "en"}] -> ${row.verdict}${row.top === undefined ? "" : ` ${row.top}`}`;
    it(where, () => {
      const [r, ...rest] = matchNames(row.input, FIXTURE, { locale: row.locale ?? "en" });
      assert.ok(r, "one result");
      assert.equal(rest.length, 0, "one result only");
      const ids = r.candidates.map((c) => c.id);
      assert.equal(r.verdict, row.verdict, JSON.stringify(r.candidates));
      if (row.top !== undefined) assert.equal(ids[0], row.top, JSON.stringify(r.candidates));
      for (const id of row.has ?? []) assert.ok(ids.includes(id), `${id} in ${ids.join(",")}`);
      if (row.reason !== undefined) assert.equal(r.candidates[0]?.reason, row.reason);
      if (row.verdict === "none") assert.deepEqual(r.candidates, []);
    });
  }
});

describe("matchNames: result shape and invariants", () => {
  const inputs = ROWS.map((r) => r.input);

  it("scores lie in 0..1, candidates are ranked, choose has 1 to 4 candidates", () => {
    for (const row of ROWS) {
      const [r] = matchNames(row.input, FIXTURE, { locale: row.locale ?? "en" });
      assert.ok(r);
      let last = 1;
      for (const c of r.candidates) {
        assert.ok(c.score >= 0 && c.score <= 1, `${row.input}: ${c.score}`);
        assert.ok(c.score <= last + 1e-9, `${row.input} not ranked`);
        last = c.score;
        assert.ok(c.label !== "" && c.matched !== "");
      }
      if (r.verdict === "choose") {
        assert.ok(r.candidates.length >= 1 && r.candidates.length <= 4, row.input);
      }
      if (r.verdict === "confident") assert.ok((r.candidates[0]?.score ?? 0) >= 0.65);
      assert.equal(new Set(r.candidates.map((c) => c.id)).size, r.candidates.length);
    }
    assert.ok(inputs.length > 60);
  });

  it("a choose between look-alikes lists both with the look-alike reason when it is not named", () => {
    const [r] = matchNames("philodendron", FIXTURE);
    assert.ok(r);
    assert.equal(r.verdict, "choose");
    assert.equal(r.candidates[1]?.id, POTHOS);
    assert.equal(r.candidates[1].reason, "lookalike");
  });

  it("labels use the locale's name, falling back to English", () => {
    const [es] = matchNames("lengua de suegra", FIXTURE, { locale: "es" });
    assert.equal(es?.candidates[0]?.label, "Lengua de suegra");
    const [it_] = matchNames("snake plant", FIXTURE, { locale: "it" });
    assert.equal(it_?.candidates[0]?.label, "Lingua di suocera");
    const [en] = matchNames("snake plant", FIXTURE, { locale: "en-GB" });
    assert.equal(en?.candidates[0]?.label, "Snake plant");
  });

  it("is deterministic and does not mutate the catalogue", () => {
    const before = JSON.stringify(FIXTURE);
    const a = matchNames(inputs, FIXTURE, { locale: "en" });
    const b = matchNames(inputs, FIXTURE, { locale: "en" });
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(FIXTURE), before);
  });

  it("an empty catalogue or empty input gives no results or none", () => {
    assert.deepEqual(matchNames("", FIXTURE), []);
    assert.deepEqual(matchNames([",,\n ;"], FIXTURE), []);
    const [r] = matchNames("snake plant", []);
    assert.equal(r?.verdict, "none");
  });
});

describe("matchNames: a bare genus", () => {
  const ids = (input: string, locale = "en"): string[] =>
    (matchNames(input, LANG_FIXTURE, { locale })[0]?.candidates ?? []).map((c) => c.id);

  it("prefers the entry named exactly that word over entries that only list a species synonym", () => {
    const [r] = matchNames("sansevieria", LANG_FIXTURE);
    assert.equal(r?.candidates[0]?.id, "sansevieria");
    assert.deepEqual(ids("sansevieria"), ["sansevieria"]);
    assert.equal(r.verdict, "confident");
  });

  it("is a choose when no entry carries that exact name", () => {
    const without = LANG_FIXTURE.filter((e) => e.id !== "sansevieria");
    const [r] = matchNames("sansevieria", without);
    assert.equal(r?.verdict, "choose");
    assert.deepEqual(r.candidates.map((c) => c.id).sort(), [
      "dracaena-angolensis",
      "dracaena-trifasciata",
    ]);
  });

  it("a synonym added to a second entry never steals the input from the first", () => {
    const only = LANG_FIXTURE.filter((e) => e.id === "dracaena-trifasciata");
    assert.equal(matchNames("sansevieria", only)[0]?.verdict, "confident");
    const both = LANG_FIXTURE.filter((e) => e.id.startsWith("dracaena-"));
    assert.equal(matchNames("sansevieria", both)[0]?.verdict, "choose");
  });
});

describe("matchNames: names per language", () => {
  const ROWS_LANG: readonly Row[] = [
    // The shop label in the user's country
    pick("geranio", ["pelargonium-hortorum", "geranium-sanguineum"], { locale: "es" }),
    pick("geranio", ["pelargonium-hortorum", "geranium-sanguineum"], { locale: "it" }),
    pick("gerani", ["pelargonium-hortorum"], { locale: "es" }),
    pick("gitanilla", ["pelargonium-hortorum"], { locale: "es", top: "pelargonium-hortorum" }),
    // The two look alike, so even a full name asks
    pick("geranio silvestre", ["geranium-sanguineum", "pelargonium-hortorum"], {
      locale: "es",
      top: "geranium-sanguineum",
    }),
    pick("geranio sanguigno", ["geranium-sanguineum", "pelargonium-hortorum"], {
      locale: "it",
      top: "geranium-sanguineum",
    }),
    pick("geranio zonale", ["pelargonium-hortorum", "geranium-sanguineum"], {
      locale: "it",
      top: "pelargonium-hortorum",
    }),
    // English aliases
    pick("cranesbill", ["geranium-sanguineum", "pelargonium-hortorum"], {
      top: "geranium-sanguineum",
      reason: "exact",
    }),
    pick("Crane's-bill", ["geranium-sanguineum"], { top: "geranium-sanguineum", reason: "exact" }),
    pick("crane's bill", ["geranium-sanguineum"], { top: "geranium-sanguineum" }),
    pick("geranium", ["pelargonium-hortorum", "geranium-sanguineum"], {
      top: "pelargonium-hortorum",
    }),
    // Pothos: a different spelling per language, all one plant (and its look-alike, so a choose)
    pick("poto", ["epipremnum-aureum", "philodendron-hederaceum"], {
      locale: "es",
      top: "epipremnum-aureum",
      reason: "exact",
    }),
    pick("poto", ["epipremnum-aureum"], { locale: "en", top: "epipremnum-aureum" }),
    pick("pothos", ["epipremnum-aureum"], { locale: "it", top: "epipremnum-aureum" }),
    pick("pothos", ["epipremnum-aureum"], { locale: "es", top: "epipremnum-aureum" }),
    // One word, two plants in two languages: never silent, the locale's plant first
    pick("yuca", ["manihot-esculenta", "yucca-gigantea"], {
      locale: "es",
      top: "manihot-esculenta",
    }),
    pick("yuca", ["manihot-esculenta", "yucca-gigantea"], { locale: "it", top: "yucca-gigantea" }),
    pick("yuca", ["manihot-esculenta", "yucca-gigantea"], { locale: "en" }),
  ];
  for (const row of ROWS_LANG) {
    it(`${row.input} [${row.locale ?? "en"}] -> ${row.verdict}`, () => {
      const [r, ...rest] = matchNames(row.input, LANG_FIXTURE, { locale: row.locale ?? "en" });
      assert.ok(r);
      assert.equal(rest.length, 0);
      const got = r.candidates.map((c) => c.id);
      assert.equal(r.verdict, row.verdict, JSON.stringify(r.candidates));
      if (row.top !== undefined) assert.equal(got[0], row.top, JSON.stringify(r.candidates));
      for (const id of row.has ?? []) assert.ok(got.includes(id), `${id} in ${got.join(",")}`);
      if (row.reason !== undefined) assert.equal(r.candidates[0]?.reason, row.reason);
    });
  }

  it("lists the user's own language first when two languages name different plants equally well", () => {
    const es = matchNames("yuca", LANG_FIXTURE, { locale: "es" })[0];
    const it_ = matchNames("yuca", LANG_FIXTURE, { locale: "it" })[0];
    assert.equal(es?.verdict, "choose");
    assert.equal(es.candidates[0]?.id, "manihot-esculenta");
    assert.equal(es.candidates[0].reason, "exact");
    assert.equal(es.candidates[1]?.reason, "common");
    assert.equal(it_?.verdict, "choose");
    assert.equal(it_.candidates[0]?.id, "yucca-gigantea");
  });

  it('"and", "y", "e" and "&" do not split a line', () => {
    for (const line of [
      "pothos and geranium",
      "geranio y poto",
      "pothos e geranio",
      "pothos & geranium",
    ]) {
      const rs = matchNames(line, LANG_FIXTURE);
      assert.equal(rs.length, 1, line);
      assert.equal(rs[0]?.input, line);
    }
  });
});

describe("matchNames: several plants in one input", () => {
  it("splits on commas, semicolons and newlines, in order, and keeps the raw text", () => {
    const rs = matchNames(
      "pothos, monstera\nsnake plant; aloe vera\r\n\r\n  rubber plant ,",
      FIXTURE,
    );
    assert.deepEqual(
      rs.map((r) => r.candidates[0]?.id),
      [POTHOS, MONSTERA, SNAKE, "aloe-vera", "ficus-elastica"],
    );
    assert.deepEqual(
      rs.map((r) => r.input),
      ["pothos", "monstera", "snake plant", "aloe vera", "rubber plant"],
    );
    assert.deepEqual(
      rs.map((r) => r.index),
      [0, 1, 2, 3, 4],
    );
  });

  it("accepts an array of inputs, each possibly a list, with one running index", () => {
    const rs = matchNames(["pothos, monstera", "snake plant"], FIXTURE);
    assert.deepEqual(
      rs.map((r) => [r.index, r.candidates[0]?.id]),
      [
        [0, POTHOS],
        [1, MONSTERA],
        [2, SNAKE],
      ],
    );
  });

  it("reads counts and flags duplicates without merging them", () => {
    const rs = matchNames(
      "2 pothos, monstera, Pothos, pothus, mystery thing, mystery thing",
      FIXTURE,
    );
    assert.deepEqual(
      rs.map((r) => r.count),
      [2, 1, 1, 1, 1, 1],
    );
    assert.equal(rs[0]?.duplicateOf, undefined);
    assert.equal(rs[2]?.duplicateOf, 0);
    assert.equal(rs[3]?.duplicateOf, 0);
    assert.equal(rs[1]?.duplicateOf, undefined);
    assert.equal(rs[4]?.verdict, "none");
    assert.equal(rs[5]?.duplicateOf, undefined, "unmatched lines are not duplicates");
  });
});

describe("createNameMatcher", () => {
  it("gives the same answers as matchNames and can be reused", () => {
    const m = createNameMatcher(FIXTURE, { locale: "es" });
    assert.deepEqual(m("hiedra"), matchNames("hiedra", FIXTURE, { locale: "es" }));
    assert.deepEqual(m("hiedra, palma"), matchNames("hiedra, palma", FIXTURE, { locale: "es" }));
  });
});

describe("matchNames: speed", () => {
  /** Deterministic fake catalogue of `n` entries with pronounceable, mostly unrelated names. */
  function bigCatalogue(n: number): MatcherEntry[] {
    let seed = 12345;
    const rnd = (m: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % m;
    };
    const syl = ["ba", "ke", "li", "mo", "nu", "ra", "so", "ti", "ve", "xa", "zu", "chi", "pha"];
    const word = (k: number): string => {
      let s = "";
      for (let i = 0; i < k; i++) s += syl[rnd(syl.length)] ?? "ba";
      return s;
    };
    const out: MatcherEntry[] = [];
    for (let i = 0; i < n; i++) {
      const genus = word(3);
      const epithet = word(3);
      out.push({
        id: `fake-${i}`,
        taxon: { scientificName: `${genus[0]?.toUpperCase() ?? ""}${genus.slice(1)} ${epithet}` },
        names: {
          common: [
            {
              lang: "en-GB",
              name: `${word(2)} ${rnd(2) === 0 ? "plant" : word(2)}`,
              primary: true,
            },
            { lang: "es", name: `${word(3)} de ${word(2)}` },
            { lang: "it", name: word(3) },
          ],
          synonyms: [`${word(3)} ${word(3)}`],
        },
        lookAlikes: [],
      });
    }
    return out;
  }

  it("matches 100 inputs against 2000 entries, index build included, in a few seconds at most", () => {
    const big = [...bigCatalogue(2000), ...FIXTURE];
    assert.ok(big.length >= 2000);
    const inputs: string[] = [];
    for (let i = 0; i < 25; i++) {
      inputs.push("snake plant", "monstra deliciosa", "mystery fernz", "big kitchen lavender");
    }
    const t0 = performance.now();
    const rs = matchNames(inputs, big, { locale: "en" });
    const ms = performance.now() - t0;
    assert.equal(rs.length, 100);
    assert.equal(rs[0]?.candidates[0]?.id, SNAKE);
    assert.equal(rs[1]?.candidates[0]?.id, MONSTERA);
    // Shared CI runners run packages in parallel and are several times slower than a dev machine.
    assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
  });
});

describe("matchNames: smoke test on the real catalogue", () => {
  const dir = new URL("../../../catalogue-draft/", import.meta.url);
  const real: MatcherEntry[] = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap(
      (f) =>
        (JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { entries: MatcherEntry[] }).entries,
    );

  it("loads the starter entries", () => {
    assert.ok(real.length >= 50);
  });

  it("every scientific name and primary English name finds its own entry first", () => {
    // A genus-only entry ties with the species of its genus on the bare genus name: a choose, correctly.
    for (const e of real) {
      const names = [
        e.taxon.scientificName,
        ...e.names.common.filter((c) => c.primary === true).map((c) => c.name),
      ];
      for (const n of names) {
        const [r] = matchNames(n, real, { locale: "en-GB" });
        assert.equal(r?.candidates[0]?.id, e.id, `${n} -> ${JSON.stringify(r?.candidates)}`);
        assert.notEqual(r.verdict, "none", n);
      }
    }
  });

  it("everyday inputs", () => {
    const top = (s: string): string | undefined =>
      matchNames(s, real, { locale: "en" })[0]?.candidates[0]?.id;
    assert.equal(top("snake plant"), "dracaena-trifasciata");
    const [sans] = matchNames("sansevieria", real, { locale: "en" });
    assert.equal(sans?.verdict, "choose", "also a synonym of dracaena-angolensis");
    assert.ok(sans.candidates.some((c) => c.id === "dracaena-trifasciata"));
    assert.ok(sans.candidates.some((c) => c.id === "dracaena-angolensis"));
    assert.equal(top("pothos"), "epipremnum-aureum");
    assert.equal(matchNames("pothos", real)[0]?.verdict, "choose", "look-alike philodendron");
    assert.equal(top("swiss cheese plant"), "monstera-deliciosa");
    assert.equal(top("monstera"), "monstera-deliciosa");
    assert.equal(top("rubber plant"), "ficus-elastica");
    const [fig] = matchNames("fig", real);
    assert.equal(fig?.verdict, "choose");
    const [ficus] = matchNames("ficus", real);
    assert.equal(ficus?.verdict, "choose");
    const [phil] = matchNames("philodendron", real);
    assert.equal(phil?.verdict, "choose", "its look-alike pothos is in the catalogue");
  });
});

describe("matchNames: crop groups and merged products", () => {
  type Name = { lang: string; name: string; primary?: boolean };
  const en = (name: string): Name => ({ lang: "en-GB", name, primary: true });
  const es = (name: string): Name => ({ lang: "es", name });
  const entry = (
    id: string,
    scientificName: string,
    common: Name[],
    synonyms: string[] = [],
  ): MatcherEntry => ({ id, taxon: { scientificName }, names: { common, synonyms } });
  const CROPS: MatcherEntry[] = [
    entry("brassica-oleracea-italica-group", "Brassica oleracea Italica Group", [
      en("Broccoli"),
      es("Brócoli"),
    ]),
    entry("brassica-oleracea-botrytis-group", "Brassica oleracea Botrytis Group", [
      en("Cauliflower"),
      es("Coliflor"),
    ]),
    entry("brassica-oleracea-acephala-group", "Brassica oleracea Acephala Group", [en("Kale")]),
    entry(
      "citrus-sinensis",
      "Citrus sinensis",
      [en("Sweet orange"), es("Naranjo")],
      ["Citrus aurantium Sinensis Group"],
    ),
    entry("citrus-aurantium", "Citrus aurantium", [en("Bitter orange"), es("Naranjo amargo")]),
  ];

  it("two entries of one species each match their own scientific and common names", () => {
    const m = createNameMatcher(CROPS);
    for (const [input, id] of [
      ["Brassica oleracea Italica Group", "brassica-oleracea-italica-group"],
      ["Brassica oleracea Botrytis Group", "brassica-oleracea-botrytis-group"],
      ["Brassica oleracea Acephala Group", "brassica-oleracea-acephala-group"],
      ["broccoli", "brassica-oleracea-italica-group"],
      ["cauliflower", "brassica-oleracea-botrytis-group"],
      ["italica group", "brassica-oleracea-italica-group"],
    ] as const) {
      const r = m(input)[0];
      assert.equal(r?.verdict, "confident", input);
      assert.equal(r.candidates[0]?.id, id, input);
    }
  });

  it("the bare species name does not silently pick one of its groups", () => {
    const r = createNameMatcher(CROPS)("Brassica oleracea")[0];
    assert.notEqual(r?.verdict, "confident");
    assert.ok((r?.candidates.length ?? 0) >= 3);
  });

  it("sweet orange and naranjo never match the bitter orange", () => {
    const m = createNameMatcher(CROPS, { locale: "es" });
    for (const input of [
      "sweet orange",
      "naranjo",
      "Citrus sinensis",
      "Citrus aurantium Sinensis Group",
    ]) {
      const r = m(input)[0];
      assert.equal(r?.verdict, "confident", input);
      assert.equal(r.candidates[0]?.id, "citrus-sinensis", input);
    }
    const bitter = m("bitter orange")[0];
    assert.equal(bitter?.candidates[0]?.id, "citrus-aurantium");
    const amargo = m("naranjo amargo")[0];
    assert.equal(amargo?.candidates[0]?.id, "citrus-aurantium");
  });
});

describe("Hermes safety", () => {
  it("the matcher uses no Unicode property escapes, which Hermes may lack", () => {
    const src = readFileSync(new URL("../src/matcher.ts", import.meta.url), "utf8");
    assert.equal(/\p\{/.test(src), false);
  });
});
