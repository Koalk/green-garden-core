// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranslator } from "@green-garden/i18n";
import { emptyData, type AppData } from "@green-garden/storage";
import { healthCheckFacts, healthCheckText, healthSearchText } from "../src/index.ts";

const en = createTranslator("en-GB");
const TODAY = "2026-11-08";

const data = (): AppData => ({
  ...emptyData(),
  rooms: [{ id: "r1", name: "Kitchen", spaceId: "space1", light: "bright_indirect" }],
  settings: { ...emptyData().settings, climate: "oceanic_dry", country: "GB" },
  plants: [
    {
      id: "p1",
      spaceId: "space1",
      name: "Monty",
      species: "Monstera deliciosa",
      roomId: "r1",
      style: "let_top_dry",
      intervalDays: 7,
      potDiameterCm: 17,
      potMaterial: "terracotta",
      logs: [
        { date: "2026-10-20", outcome: "done" },
        { date: "2026-10-27", outcome: "skipped" },
        { date: "2026-11-02", outcome: "done" },
      ],
    },
    { id: "p2", spaceId: "space1", name: "Bare", style: "keep_moist", intervalDays: 5 },
    {
      id: "p3",
      spaceId: "space1",
      name: "Lavender",
      species: "Lavandula angustifolia",
      placement: "ground",
      style: "let_fully_dry",
      intervalDays: 14,
      logs: [
        { date: "2026-11-05", outcome: "rain", mm: 4 },
        { date: "2026-11-07", outcome: "rain", mm: 3 },
        { date: "2026-10-01", outcome: "rain", mm: 20 },
      ],
    },
  ],
});
const facts = (id: string, extra = {}) => {
  const f = healthCheckFacts(en, data(), id, TODAY, {
    locale: "en-GB",
    commonName: "Swiss cheese plant",
    scientificName: "Monstera deliciosa",
    hadSince: "2026-03-01",
    openItems: ["Pot size", "Light"],
    ...extra,
  });
  assert.ok(f);
  return f;
};

describe("health check prompt", () => {
  it("names the plant, its place, pot, time owned, season, climate, watering and open items", () => {
    const text = healthCheckText(en, facts("p1"));
    assert.match(text, /Swiss cheese plant \(Monstera deliciosa\)/);
    assert.match(text, /Genus: Monstera/);
    assert.match(text, /Kitchen/);
    assert.match(text, /bright indirect light/);
    assert.match(text, /terracotta/);
    assert.match(text, /17 cm/);
    assert.match(text, /about 8 months/);
    assert.match(text, /November/);
    assert.match(text, /autumn/);
    assert.match(text, /Wet: mild, rain all year/);
    assert.match(text, /United Kingdom/);
    assert.match(text, /every 7 days/);
    assert.match(text, /2026-11-02 done/);
    assert.match(text, /2026-10-27 skipped/);
    assert.match(text, /Pot size; Light/);
  });

  it("ends with the symptoms line and the closing ask", () => {
    const lines = healthCheckText(en, facts("p1")).trimEnd().split("\n");
    assert.match(
      lines.at(-2) ?? "",
      /^Symptoms: \{describe what you see: where on the plant, colour, since when\}$/,
    );
    assert.equal(lines.at(-1), "What could cause this, and what should I check or do first?");
  });

  it("typed symptoms replace the placeholder", () => {
    const text = healthCheckText(en, facts("p1"), "  yellow lower leaves since last week ");
    assert.match(text, /^Symptoms: yellow lower leaves since last week$/m);
    assert.doesNotMatch(text, /describe what you see/);
  });

  it("leaves out what is not known and never prints 'unknown'", () => {
    const f = healthCheckFacts(en, data(), "p2", TODAY, { locale: "en-GB" });
    assert.ok(f);
    const text = healthCheckText(en, f);
    assert.doesNotMatch(text, /unknown|undefined|null|NaN/i);
    assert.doesNotMatch(text, /genus|family|Pot:|room|Rain in/i);
    assert.match(text, /Symptoms:/);
  });

  it("never prints coordinates or the plant's own name when a species is known", () => {
    const text = healthCheckText(en, facts("p1"));
    assert.doesNotMatch(text, /latitude|longitude|°\s?[NS]\b/i);
  });

  it("outdoors: says where it lives and sums the rain of the last week only", () => {
    const text = healthCheckText(
      en,
      facts("p3", { commonName: "Lavender", scientificName: "Lavandula angustifolia" }),
    );
    assert.match(text, /in the ground/);
    assert.match(text, /7 mm of rain/);
    assert.doesNotMatch(text, /27 mm|20 mm/);
  });

  it("the south flips the season", () => {
    const d = { ...data(), settings: { ...data().settings, hemisphere: "south" as const } };
    const f = healthCheckFacts(en, d, "p1", TODAY, { locale: "en-GB" });
    assert.ok(f);
    assert.match(healthCheckText(en, f), /spring/);
  });

  it("follows the app language", () => {
    const es = createTranslator("es");
    const f = healthCheckFacts(es, data(), "p1", TODAY, { locale: "es" });
    assert.ok(f);
    const text = healthCheckText(es, f);
    assert.match(text, /noviembre/);
    assert.match(text, /Síntomas:/);
    assert.doesNotMatch(text, /Symptoms/);
  });

  it("the web search text is the names plus the symptoms or the placeholder", () => {
    assert.equal(
      healthSearchText(en, facts("p1"), "yellow leaves"),
      "Monstera deliciosa Swiss cheese plant yellow leaves",
    );
    assert.match(healthSearchText(en, facts("p1")), /^Monstera deliciosa Swiss cheese plant /);
    assert.match(healthSearchText(en, facts("p1")), /symptoms/i);
  });

  it("an unknown plant gives nothing", () => {
    assert.equal(healthCheckFacts(en, data(), "nope", TODAY, { locale: "en-GB" }), undefined);
  });
});

describe("health check 'had it for' reads addedOn", () => {
  const withAdded = (added: Record<string, unknown>) => {
    const d = data();
    return {
      ...d,
      plants: d.plants.map((p) => (p.id === "p1" ? { ...p, ...added } : p)),
    } as AppData;
  };
  const had = (d: AppData, extra = {}) =>
    healthCheckFacts(en, d, "p1", TODAY, { locale: "en-GB", ...extra })?.had;

  it("uses the plant's addedOn over the caller's day", () => {
    assert.equal(
      had(withAdded({ addedOn: "2025-11-08" }), { hadSince: "2026-11-01" }),
      "about 12 months",
    );
  });
  it("leaves 'had it' out when estimated and under a week, keeps it when real", () => {
    assert.equal(had(withAdded({ addedOn: "2026-11-05", addedOnEstimated: true })), undefined);
    assert.equal(had(withAdded({ addedOn: "2026-11-05" })), "about 3 days");
    assert.equal(
      had(withAdded({ addedOn: "2026-10-01", addedOnEstimated: true })),
      "about 38 days",
    );
  });
});
