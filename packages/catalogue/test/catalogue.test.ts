// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- tests poke into untyped JSON */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { petToxicityWarnings, stats, validateCatalogue } from "../src/index.ts";
// Tests carry no literal remote URLs (check:no-network).
const HTTPS = "https:" + "//";
const HTTP = "http:" + "//";

const dir = new URL("../../../catalogue-draft/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const loaded = files.map((f) => ({
  f,
  json: JSON.parse(readFileSync(new URL(f, dir), "utf8")) as unknown,
}));

// Research runs (rows 51 to 200). Each batch of 5 extends this list first (red), then the files.
const RESEARCHED = [
  // batch 1a: rows 53, 56, 61, 72, 80
  "pelargonium-x-hortorum",
  "petunia-x-atkinsiana",
  "cyclamen-persicum",
  "begonia-x-tuberhybrida",
  "pelargonium-peltatum",
  // batch 1b: rows 81, 82, 92, 109, 110
  "impatiens-walleriana",
  "mentha-spicata",
  "coleus-scutellarioides",
  "howea-forsteriana",
  "echeveria-elegans",
  // batch 1c: rows 136, 137, 139, 140, 141
  "euphorbia-pulcherrima",
  "chrysanthemum-x-morifolium",
  "gardenia-jasminoides",
  "clivia-miniata",
  "asparagus-setaceus",
  // batch 1d: rows 144, 147, 148, 160, 162
  "dracaena-angolensis",
  "lobelia-erinus",
  "dichondra-argentea",
  "petroselinum-crispum",
  "ocimum-basilicum",
  // batch 1e: rows 180, 181, 192, 193, 194
  "mandevilla-sanderi",
  "jasminum-sambac",
  "haworthiopsis-attenuata",
  "opuntia-microdasys",
  "adiantum-raddianum",
  // batch 1f: rows 195 to 199
  "platycerium-bifurcatum",
  "begonia-rex-cultorum",
  "ulmus-parvifolia",
  "goeppertia-orbifolia",
  "begonia-maculata",
  // batch 1g: row 200
  "trachelospermum-jasminoides",
  // batch 2a: rows 51, 52, 54, 55, 57
  "lavandula-angustifolia",
  "hydrangea-macrophylla",
  "salvia-rosmarinus",
  "rosa",
  "fuchsia-magellanica",
  // batch 2b: rows 58, 59, 60, 62, 63
  "hosta",
  "thymus-vulgaris",
  "dahlia",
  "agapanthus-africanus",
  "olea-europaea",
  // batch 3: rows 64, 65, 66, 67, 68
  "salvia-nemorosa",
  "begonia-cucullata",
  "rhododendron",
  "salvia-officinalis",
  "viola-x-wittrockiana",
  // batch 4: rows 70, 73, 74, 75, 76
  "nerium-oleander",
  "jasminum-officinale",
  "narcissus-pseudonarcissus",
  "buxus-sempervirens",
  "pittosporum-tenuifolium",
  // batch 6 (run 12): calamondin (row 232), rows 87 to 90
  "citrus-x-microcarpa",
  "tulipa-gesneriana",
  "lantana-camara",
  "hylotelephium-spectabile",
  "clematis",
  // batch 7 (run 13): rows 91, 93, 94, 95, 96
  "zinnia-elegans",
  "fragaria-x-ananassa",
  "lactuca-sativa",
  "camellia-japonica",
  "photinia-x-fraseri",
  // batch 8 (run 14): rows 97 to 101
  "choisya-ternata",
  "ilex-aquifolium",
  "daphne-odora",
  "abelia-x-grandiflora",
  "dryopteris-erythrosora",
  // batch 9 (run 15): rows 102 to 106
  "nassella-tenuissima",
  "festuca-glauca",
  "cenchrus-alopecuroides",
  "crocosmia-x-crocosmiiflora",
  "yucca-gloriosa",
];

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("catalogue-draft pilot files", () => {
  it("holds at least the 50 starter entries, one per file, with the file named after the entry id", () => {
    assert.ok(files.length >= 50);
    for (const { f, json } of loaded) {
      const entries = (json as { entries: { id: string }[] }).entries;
      assert.equal(entries.length, 1, f);
      assert.equal(`${String(entries[0]?.id)}.json`, f);
    }
  });

  // Batch 3 (starter-list rows 26 to 50). Each batch of 5 extends this list first (red), then the files.
  const BATCH3 = [
    "dypsis-lutescens",
    "dracaena-sanderiana",
    "nephrolepis-exaltata",
    "dracaena-fragrans",
    "ceropegia-woodii",
    "curio-rowleyanus",
    "beaucarnea-recurvata",
    "schlumbergera-truncata",
    "phalaenopsis",
    "codiaeum-variegatum",
    "asplenium-nidus",
    "schefflera-arboricola",
    "guzmania",
    "streptocarpus",
    "oxalis-triangularis",
    "alocasia",
    "maranta-leuconeura",
    "tradescantia-zebrina",
    "pachira-aquatica",
    "ficus-benjamina",
    "kalanchoe-blossfeldiana",
    "araucaria-heterophylla",
    "syngonium-podophyllum",
    "hypoestes-phyllostachya",
    "scindapsus-pictus",
  ];
  it("has the batch 3 starter-list entries", () => {
    for (const id of BATCH3) assert.ok(files.includes(`${id}.json`), `missing ${id}.json`);
  });

  it("has the entries written so far", () => {
    for (const id of RESEARCHED) assert.ok(files.includes(`${id}.json`), `missing ${id}.json`);
  });

  for (const { f, json } of loaded) {
    it(`${f} is schema-valid`, () => {
      assert.deepEqual(validateCatalogue(json), []);
    });
  }

  it("never shows an unsourced toxicity as safe: unknown status has no exposures", () => {
    for (const { json } of loaded) {
      const e = (json as { entries: { toxicity: { status: string; exposures: unknown[] } }[] })
        .entries[0];
      if (e?.toxicity.status === "unknown") assert.equal(e.toxicity.exposures.length, 0);
    }
  });

  it("reports counts that add up", () => {
    const s = stats(loaded.map((l) => l.json));
    assert.equal(s.checked + s.fromKnowledge + s.guess + s.unknown, s.values);
    assert.equal(s.nonNullValues, s.values - s.unknown);
    assert.ok(s.twoSources <= s.nonNullValues);
  });
});

const photo = (over: Record<string, string> = {}): Record<string, string> => ({
  file: "Aglaonema.jpg",
  thumbnail: "aglaonema.webp",
  licence: "CC-BY-4.0",
  creator: "x",
  licenceUrl: "u",
  sourceUrl: "s",
  ...over,
});

describe("validateCatalogue catches rule violations", () => {
  const base = loaded.find(({ f }) => f === "aglaonema.json")?.json; // a fully populated starter entry
  assert.ok(base);

  const mutate = (fn: (e: Record<string, any>, f: Record<string, any>) => void): string[] => {
    const f = clone(base) as Record<string, any>;
    fn(f["entries"][0], f);
    return validateCatalogue(f);
  };

  it("rejects junk", () => {
    assert.ok(validateCatalogue(null).length > 0);
    assert.ok(validateCatalogue({}).length > 0);
  });

  it("value with an unknown source", () => {
    const errs = mutate((e) => (e["care"]["wateringStyle"]["source"] = "nope"));
    assert.ok(errs.some((x) => x.includes("source missing")));
  });

  it("checked with author knowledge", () => {
    const errs = mutate((e) => {
      e["care"]["baseIntervalDays"]["source"] = "author";
      delete e["care"]["baseIntervalDays"]["corroboratedBy"];
      e["care"]["baseIntervalDays"]["confidence"] = "checked";
    });
    assert.ok(errs.some((x) => x.includes("checked needs")));
  });

  it("null value without unknown", () => {
    const errs = mutate((e) => {
      e["care"]["light"] = { value: null, source: null, confidence: "checked" };
    });
    assert.ok(errs.some((x) => x.includes("null value")));
  });

  it("negative tolerance and bad range", () => {
    const errs = mutate((e) => {
      e["care"]["dryToleranceDays"]["value"] = -1;
      e["care"]["temperatureC"] = {
        value: { min: 30, max: 10 },
        source: "author",
        confidence: "guess",
      };
    });
    assert.equal(errs.length, 2);
  });

  it("user confidence is refused", () => {
    const errs = mutate((e) => (e["care"]["habit"]["confidence"] = "user"));
    assert.ok(errs.some((x) => x.includes("user confidence")));
  });

  it("toxicity: severity range, symptom vocabulary, severity 0 with symptoms", () => {
    const errs = mutate((e) => {
      e["toxicity"] = {
        status: "assessed",
        agents: [],
        sources: [],
        exposures: [
          {
            who: "cat",
            route: "ingest",
            severity: 4,
            symptoms: ["sneezing"],
            source: "author",
            confidence: "guess",
          },
          {
            who: "dog",
            route: "ingest",
            severity: 0,
            symptoms: ["vomiting"],
            source: "author",
            confidence: "guess",
          },
        ],
      };
    });
    assert.ok(errs.some((x) => x.includes("severity must be")));
    assert.ok(errs.some((x) => x.includes("unknown symptom")));
    assert.ok(errs.some((x) => x.includes("severity 0 with symptoms")));
  });

  it("unknown toxicity may not carry exposures", () => {
    const errs = mutate((e) => {
      e["toxicity"] = { status: "unknown", agents: [], sources: [], exposures: [{}] };
    });
    assert.ok(errs.some((x) => x.includes("unknown status")));
  });

  it("photo needs an allowed licence and attribution", () => {
    const errs = mutate((e) => {
      e["photos"] = [{ licence: "CC-BY-NC-4.0", creator: "x", licenceUrl: "u", sourceUrl: "s" }];
    });
    assert.ok(errs.some((x) => x.includes("photo needs")));
  });

  it("photo licences: every CC BY and CC BY-SA version, CC0 and public domain are allowed", () => {
    for (const licence of [
      "CC-BY-2.0",
      "CC-BY-3.0",
      "CC-BY-4.0",
      "CC-BY-SA-2.0",
      "CC-BY-SA-3.0",
      "CC-BY-SA-4.0",
      "CC0-1.0",
      "PDM-1.0",
    ]) {
      const errs = mutate((e) => {
        e["photos"] = [photo({ licence })];
      });
      assert.deepEqual(
        errs.filter((x) => x.includes("photo")),
        [],
        licence,
      );
    }
  });

  it("photo licences: NC, ND, GFDL and unversioned strings stay refused", () => {
    for (const licence of [
      "CC-BY-NC-3.0",
      "CC-BY-ND-2.0",
      "CC-BY-SA-NC-4.0",
      "GFDL-1.2",
      "CC-BY",
      "CC-BY-5.0",
    ]) {
      const errs = mutate((e) => {
        e["photos"] = [photo({ licence })];
      });
      assert.ok(
        errs.some((x) => x.includes("photo needs")),
        licence,
      );
    }
  });

  it("photo needs a Commons file name and a bundled thumbnail", () => {
    for (const drop of ["file", "thumbnail"]) {
      const errs = mutate((e) => {
        const p: Record<string, string> = { ...photo(), [drop]: "" };
        e["photos"] = [p];
      });
      assert.ok(
        errs.some((x) => x.includes("photo needs")),
        drop,
      );
    }
    const bad = mutate((e) => {
      e["photos"] = [photo({ thumbnail: "../x.png" })];
    });
    assert.ok(bad.some((x) => x.includes("photo needs")));
  });

  it("source without https url or access", () => {
    const errs = mutate((_e, f) => {
      const s = (f["sources"] as Record<string, unknown>[]).find(
        (x) => x["kind"] !== "author_knowledge",
      );
      assert.ok(s);
      s["url"] = "ftp-not-https";
      delete s["access"];
    });
    assert.ok(errs.some((x) => x.includes("https")));
    assert.ok(errs.some((x) => x.includes("access")));
  });

  it("duplicate source and entry ids", () => {
    const errs = mutate((e, f) => {
      (f["sources"] as unknown[]).push(clone((f["sources"] as unknown[])[0]));
      (f["entries"] as unknown[]).push(clone(e));
    });
    assert.ok(errs.some((x) => x.includes("duplicate")));
  });

  it("corroboratedBy must exist and differ from the main source", () => {
    const errs = mutate((e) => {
      e["care"]["wateringStyle"]["corroboratedBy"] = [
        "ghost",
        e["care"]["wateringStyle"]["source"],
      ];
    });
    assert.equal(errs.length, 2);
  });
});

describe("sources read", () => {
  const base = loaded.find(({ f }) => f === "aglaonema.json")?.json; // a fully populated starter entry
  assert.ok(base);
  const mutate = (fn: (e: Record<string, any>, f: Record<string, any>) => void): string[] => {
    const f = clone(base) as Record<string, any>;
    fn(f["entries"][0], f);
    return validateCatalogue(f);
  };
  const cited = (f: Record<string, any>): Record<string, any> =>
    (f["sources"] as Record<string, any>[]).find(
      (s) => s["id"] === f["entries"][0]["care"]["wateringStyle"]["source"],
    ) as Record<string, any>;

  it("every entry lists the pages it read", () => {
    const errs = mutate((e) => delete e["sourcesRead"]);
    assert.ok(errs.some((x) => x.includes("sourcesRead")));
  });

  it("a cited URL missing from sourcesRead is refused", () => {
    const errs = mutate((e) => (e["sourcesRead"] = []));
    assert.ok(errs.some((x) => x.includes("not in sourcesRead")));
  });

  it("a sourcesRead URL must be https and unique", () => {
    const errs = mutate((e) => (e["sourcesRead"] = ["ftp-not-https", "ftp-not-https"]));
    assert.ok(errs.some((x) => x.includes("sourcesRead url")));
  });

  it("a cited source known only from a search summary is refused", () => {
    const errs = mutate((_e, f) => (cited(f)["access"] = "search_summary"));
    assert.ok(errs.some((x) => x.includes("not fetched")));
  });
});

describe("look-alikes, name ideas and photo file", () => {
  const base = (): any => clone(loaded[0]?.json);
  const first = (f: any): any => f.entries[0];

  it("accepts well-formed lookAlikes, nameIdeas and photoFile", () => {
    const f = base();
    first(f).lookAlikes = [
      { name: "Mondo grass", tell: "No runners." },
      { name: "Aloe vera", species: "aloe-vera", tell: "Gel-filled leaves." },
    ];
    first(f).lookAlikeNote = "Mondo grass is safe; this one is not.";
    first(f).nameIdeas = ["Sansevieria Sam", "Snakespeare"];
    first(f).photoFile = "Dracaena trifasciata 177940020.jpg";
    assert.deepEqual(validateCatalogue(f), []);
  });

  it("rejects a look-alike without a name or without the distinguishing feature", () => {
    const f = base();
    first(f).lookAlikes = [{ name: "", tell: "x" }, { name: "Y" }];
    const errs = validateCatalogue(f);
    assert.equal(errs.filter((e) => e.includes("lookAlikes")).length, 2, errs.join("\n"));
  });

  it("rejects a look-alike species id that is not a slug", () => {
    const f = base();
    first(f).lookAlikes = [{ name: "X", species: "Not A Slug", tell: "t" }];
    assert.ok(validateCatalogue(f).some((e) => e.includes("lookAlikes")));
  });

  it("rejects empty or non-string nameIdeas and an empty photoFile", () => {
    const f = base();
    first(f).nameIdeas = ["ok", "", 3];
    first(f).photoFile = "";
    const errs = validateCatalogue(f);
    assert.ok(
      errs.some((e) => e.includes("nameIdeas")),
      errs.join("\n"),
    );
    assert.ok(
      errs.some((e) => e.includes("photoFile")),
      errs.join("\n"),
    );
  });

  it("every species id named by a look-alike exists in the catalogue", () => {
    const ids = new Set(loaded.map(({ json }) => (json as any).entries[0].id as string));
    for (const { f, json } of loaded)
      for (const la of ((json as any).entries[0].lookAlikes ?? []) as { species?: string }[])
        if (la.species !== undefined) assert.ok(ids.has(la.species), `${f}: ${la.species}`);
  });

  it("entries that have no look-alikes recorded yet are the ones without the field", () => {
    const missing = loaded.filter(
      ({ f, json }) =>
        !RESEARCHED.includes(f.replace(/.json$/, "")) &&
        (json as any).entries[0].lookAlikes === undefined,
    );
    // covered 20 of the 25; the other five are marked by the absent field and shown as such.
    assert.deepEqual(
      missing.map(({ f }) => f),
      [
        "aglaonema.json",
        "goeppertia-makoyana.json",
        "spathiphyllum-wallisii.json",
        "streptocarpus-ionanthus.json",
        "tillandsia.json",
      ],
    );
  });
});

describe("Dieffenbachia toxicity", () => {
  it("rates ingestion by cats, dogs and children as 3, can be life-threatening", () => {
    const e = (loaded.find(({ f }) => f === "dieffenbachia-seguine.json")?.json as any).entries[0];
    const ingest = (e.toxicity.exposures as { who: string; route: string; severity: number }[])
      .filter((x) => x.route === "ingest")
      .map((x) => `${x.who}:${x.severity}`);
    assert.deepEqual(ingest, ["cat:3", "dog:3", "child:3"]);
  });
});

describe("translated names and tips", () => {
  const base = loaded.find(({ f }) => f === "aglaonema.json")?.json; // a fully populated starter entry
  assert.ok(base);
  const mutate = (fn: (e: Record<string, any>) => void): string[] => {
    const f = clone(base) as Record<string, any>;
    fn(f["entries"][0]);
    return validateCatalogue(f);
  };
  const es = { lang: "es", name: "Aloe", translation: { status: "machine" } };

  it("accepts several names per language and a translated name with its status", () => {
    assert.deepEqual(
      mutate((e) => {
        e["names"]["common"].push(es, {
          lang: "es",
          name: "Sábila",
          translation: { status: "reviewed", reviewedBy: "Reviewer", reviewedOn: "2026-10-28" },
        });
      }),
      [],
    );
  });

  it("accepts a watering tip as a list with one entry per language", () => {
    assert.deepEqual(
      mutate((e) => {
        const en = e["care"]["wateringTip"];
        e["care"]["wateringTip"] = [
          en,
          { lang: "it", text: "Annaffia poco.", translation: { status: "machine" } },
        ];
      }),
      [],
    );
  });

  it("needs an en-GB common name and an en-GB tip", () => {
    const noEnName = mutate((e) => {
      e["names"]["common"] = [es];
    });
    assert.ok(
      noEnName.some((x) => x.includes("en-GB common name")),
      noEnName.join("|"),
    );
    const noEnTip = mutate((e) => {
      e["care"]["wateringTip"] = [
        { lang: "es", text: "Riega poco.", translation: { status: "machine" } },
      ];
    });
    assert.ok(
      noEnTip.some((x) => x.includes("en-GB")),
      noEnTip.join("|"),
    );
  });

  it("rejects a language tag that is not BCP 47", () => {
    const errs = mutate((e) => {
      e["names"]["common"].push({
        lang: "spanish please",
        name: "x",
        translation: { status: "machine" },
      });
    });
    assert.ok(
      errs.some((x) => x.includes("BCP 47")),
      errs.join("|"),
    );
  });

  it("a translated entry must say machine or reviewed", () => {
    const missing = mutate((e) => {
      e["names"]["common"].push({ lang: "es", name: "Aloe" });
    });
    assert.ok(
      missing.some((x) => x.includes("translation status")),
      missing.join("|"),
    );
    const bad = mutate((e) => {
      e["names"]["common"].push({ lang: "es", name: "Aloe", translation: { status: "trust me" } });
    });
    assert.ok(
      bad.some((x) => x.includes("translation status")),
      bad.join("|"),
    );
  });

  it("an alias list in a language needs the machine flag, a review or a listed source", () => {
    const mutateFile = (fn: (f: Record<string, any>) => void): string[] => {
      const f = clone(base) as Record<string, any>;
      fn(f);
      return validateCatalogue(f);
    };
    const sourceId = (base as Record<string, any>)["sources"][0]["id"] as string;
    // An alias per language, from a shop label: a source stands in for the translation status.
    assert.deepEqual(
      mutateFile((f) => {
        f["entries"][0]["names"]["common"].push(
          { lang: "es", name: "Geranio", source: sourceId },
          { lang: "es", name: "Gitanilla", translation: { status: "machine" } },
        );
      }),
      [],
    );
    const unknownSource = mutateFile((f) => {
      f["entries"][0]["names"]["common"].push({ lang: "es", name: "Geranio", source: "nope" });
    });
    assert.ok(
      unknownSource.some((x) => x.includes("translation status")),
      unknownSource.join("|"),
    );
    const bare = mutateFile((f) => {
      f["entries"][0]["names"]["common"].push({ lang: "it", name: "Geranio" });
    });
    assert.ok(
      bare.some((x) => x.includes("translation status")),
      bare.join("|"),
    );
    // English aliases need nothing extra: en-GB is the language the entry is written in.
    assert.deepEqual(
      mutateFile((f) => {
        f["entries"][0]["names"]["common"].push({ lang: "en-GB", name: "Cranesbill" });
      }),
      [],
    );
  });

  it("every shipped entry still has en-GB name and tip", () => {
    for (const { f, json } of loaded) assert.deepEqual(validateCatalogue(json), [], f);
  });
});

describe("in-ground fields, life cycle and water-need ratio", () => {
  const base = loaded.find(({ f }) => f === "aglaonema.json")?.json; // a fully populated starter entry
  assert.ok(base);
  const mutate = (fn: (e: Record<string, any>) => void): string[] => {
    const f = clone(base) as Record<string, any>;
    fn(f["entries"][0]);
    return validateCatalogue(f);
  };
  const v = (value: unknown): Record<string, unknown> => ({
    value,
    source: "author",
    confidence: "guess",
  });
  const unknown = { value: null, source: null, confidence: "unknown" };

  it("accepts every new field with a valid value", () => {
    assert.deepEqual(
      mutate((e) => {
        const c = e["care"];
        c["placement"] = v(["pot_outdoor", "ground"]);
        c["hardiness"] = v("H4");
        c["rootDepthClass"] = v("medium");
        c["droughtTolerance"] = v("high");
        c["establishment"] = { seasons: v(2), intervalDays: v(7) };
        c["dormancy"] = v("winter");
        c["sunNeed"] = v("full");
        c["soilPreference"] = v("free_draining");
        c["wateringTipGround"] = { lang: "en-GB", text: "Soak deeply, then leave it alone." };
        c["lifecycle"] = v("perennial");
        c["waterNeedRatio"] = v(0.6);
      }),
      [],
    );
  });

  it("unknown stays null with confidence unknown, also inside establishment", () => {
    assert.deepEqual(
      mutate((e) => {
        e["care"]["placement"] = v(["ground"]);
        e["care"]["hardiness"] = unknown;
        e["care"]["establishment"] = { seasons: unknown, intervalDays: unknown };
        e["care"]["waterNeedRatio"] = unknown;
      }),
      [],
    );
  });

  it("rejects values outside the enums", () => {
    const errs = mutate((e) => {
      const c = e["care"];
      c["placement"] = v(["balcony"]);
      c["hardiness"] = v("H9");
      c["rootDepthClass"] = v("tap");
      c["droughtTolerance"] = v("extreme");
      c["dormancy"] = v("autumn");
      c["sunNeed"] = v("blazing");
      c["soilPreference"] = v("rocky");
      c["lifecycle"] = v("triennial");
    });
    for (const k of [
      "placement",
      "hardiness",
      "rootDepthClass",
      "droughtTolerance",
      "dormancy",
      "sunNeed",
      "soilPreference",
      "lifecycle",
    ]) {
      assert.ok(
        errs.some((x) => x.includes(`.${k}:`)),
        `${k}: ${errs.join("|")}`,
      );
    }
  });

  it("establishment: seasons 1 to 3, interval at least 1 day", () => {
    const errs = mutate((e) => {
      e["care"]["establishment"] = { seasons: v(4), intervalDays: v(0) };
    });
    assert.ok(
      errs.some((x) => x.includes("establishment.seasons")),
      errs.join("|"),
    );
    assert.ok(
      errs.some((x) => x.includes("establishment.intervalDays")),
      errs.join("|"),
    );
  });

  it("waterNeedRatio is 0.1 to 1.5", () => {
    for (const bad of [0.05, 1.6, -1]) {
      const errs = mutate((e) => {
        e["care"]["placement"] = v(["ground"]);
        e["care"]["waterNeedRatio"] = v(bad);
      });
      assert.ok(
        errs.some((x) => x.includes("waterNeedRatio")),
        `${bad}: ${errs.join("|")}`,
      );
    }
    for (const ok of [0.1, 0.73, 1.5]) {
      const errs = mutate((e) => {
        e["care"]["placement"] = v(["pot_outdoor"]);
        e["care"]["waterNeedRatio"] = v(ok);
      });
      assert.deepEqual(errs, [], String(ok));
    }
  });

  it("waterNeedRatio needs a placement that includes pot_outdoor or ground", () => {
    const none = mutate((e) => (e["care"]["waterNeedRatio"] = v(0.5)));
    assert.ok(
      none.some((x) => x.includes("waterNeedRatio") && x.includes("placement")),
      none.join("|"),
    );
    const indoorOnly = mutate((e) => {
      e["care"]["placement"] = v(["indoor"]);
      e["care"]["waterNeedRatio"] = v(0.5);
    });
    assert.ok(
      indoorOnly.some((x) => x.includes("waterNeedRatio")),
      indoorOnly.join("|"),
    );
    const unknownPlacement = mutate((e) => {
      e["care"]["placement"] = unknown;
      e["care"]["waterNeedRatio"] = v(0.5);
    });
    assert.ok(
      unknownPlacement.some((x) => x.includes("waterNeedRatio")),
      unknownPlacement.join("|"),
    );
  });

  it("the ground watering tip needs an en-GB text and stays one sentence", () => {
    const noEn = mutate((e) => {
      e["care"]["wateringTipGround"] = {
        lang: "es",
        text: "Riega a fondo.",
        translation: { status: "machine" },
      };
    });
    assert.ok(
      noEn.some((x) => x.includes("wateringTipGround")),
      noEn.join("|"),
    );
    const long = mutate((e) => {
      e["care"]["wateringTipGround"] = { lang: "en-GB", text: "x".repeat(201) };
    });
    assert.ok(
      long.some((x) => x.includes("wateringTipGround")),
      long.join("|"),
    );
  });

  it("stats count the establishment values too", () => {
    const f = clone(base) as Record<string, any>;
    const before = stats([f]).values;
    f["entries"][0]["care"]["establishment"] = { seasons: v(2), intervalDays: v(7) };
    assert.equal(stats([f]).values, before + 2);
  });
});

describe("reference-pot anchors from the 3-litre study", () => {
  const entry = (id: string): Record<string, any> => {
    const json = loaded.find(({ f }) => f === `${id}.json`)?.json as Record<string, any>;
    return (json["entries"] as Record<string, any>[])[0] as Record<string, any>;
  };
  const study = "gubb-houseplants-3l";
  const anchors: [string, number][] = [
    ["hedera-helix", 5],
    // 7 for the 13 cm reference pot (the study measured the 3-litre pot, about 5 days).
    ["spathiphyllum-wallisii", 7],
    ["dracaena-fragrans", 8],
    ["guzmania", 13],
  ];
  for (const [id, days] of anchors) {
    it(`${id}: baseIntervalDays ${days}, guess, from the study`, () => {
      const e = entry(id);
      const b = e.care.baseIntervalDays;
      assert.equal(b.value, days);
      assert.equal(b.confidence, "guess");
      assert.equal(b.source, study);
      assert.ok(e.sourcesRead.some((u: string) => u.includes("greenplantsforgreenbuildings.org")));
    });
  }
  it("peace lily: let the top dry (sources say moist, then dry slightly)", () => {
    assert.equal(entry("spathiphyllum-wallisii").care.wateringStyle.value, "let_top_dry");
  });
  it("other species keep their style default", () => {
    assert.equal(entry("dracaena-marginata").care.baseIntervalDays.value, 12);
  });
});

describe("pet toxicity warnings", () => {
  it("warns for assessed entries with no cat or dog exposure, and only then", () => {
    const base = (who: string[]) => ({
      id: "x",
      toxicity: { status: "assessed", exposures: who.map((w) => ({ who: w, severity: 1 })) },
    });
    assert.equal(petToxicityWarnings({ entries: [base(["adult", "child"])] }).length, 1);
    assert.equal(petToxicityWarnings({ entries: [base(["adult", "dog"])] }).length, 0);
    assert.equal(
      petToxicityWarnings({
        entries: [{ id: "u", toxicity: { status: "unknown", exposures: [] } }],
      }).length,
      0,
    );
  });

  it("lists the shipped entries without pet gradings (skimmia, dichondra, mandevilla)", (t) => {
    const warned = loaded.flatMap((l) => petToxicityWarnings(l.json)).join("\n");
    t.diagnostic(`pets not assessed (warning):
${warned}`);
    for (const id of ["skimmia-japonica", "dichondra-argentea", "mandevilla-sanderi"])
      assert.match(warned, new RegExp(id));
  });
});

describe("links and source languages", () => {
  const fixture = (): any => structuredClone(loaded[0]?.json);
  const link = {
    url: `${HTTPS}example.org/a`,
    title: "A",
    publisher: "P",
    lang: "es",
    kind: "care",
  };

  it("accepts a good links list", () => {
    const f = fixture();
    f.entries[0].links = [link];
    assert.deepEqual(validateCatalogue(f), []);
  });

  it("rejects http, a missing lang, a bad kind and duplicate URLs", () => {
    const bad = (l: unknown[]): string[] => {
      const f = fixture();
      f.entries[0].links = l;
      return validateCatalogue(f);
    };
    assert.match(bad([{ ...link, url: `${HTTP}example.org/a` }]).join(" "), /https/);
    assert.match(bad([{ ...link, lang: undefined }]).join(" "), /lang/);
    assert.match(bad([{ ...link, kind: "shop" }]).join(" "), /kind/);
    assert.match(bad([link, { ...link }]).join(" "), /duplicate/);
  });

  it("needs a lang on each source that has a URL", () => {
    const f = fixture();
    const s = f.sources.find((x: any) => x.kind !== "author_knowledge");
    delete s.lang;
    assert.match(validateCatalogue(f).join(" "), /lang/);
  });
});

describe("RHS hardiness for camellia and photinia", () => {
  for (const [file, source] of [
    ["camellia-japonica.json", "rhs-camellia-japonica"],
    ["photinia-x-fraseri.json", "rhs-photinia-x-fraseri-red-robin"],
  ] as const) {
    it(`${file} stores the RHS H value as checked`, () => {
      const h = (loaded.find(({ f }) => f === file)?.json as any).entries[0].care.hardiness;
      assert.equal(h?.value, "H5");
      assert.equal(h?.source, source);
      assert.equal(h?.confidence, "checked");
    });
  }
});

describe("catalogue-draft watering style", () => {
  it("every entry with a base interval also has a watering style", () => {
    const missing: string[] = [];
    for (const { f, json } of loaded) {
      const care = (
        json as {
          entries: {
            care: {
              baseIntervalDays: { value: number | null };
              wateringStyle: { value: string | null };
            };
          }[];
        }
      ).entries[0]?.care;
      if (care?.baseIntervalDays.value != null && care.wateringStyle.value === null)
        missing.push(f);
    }
    assert.deepEqual(missing, []);
  });
});
