// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import {
  careDetailsHtml,
  draftsHtml,
  modalHtml,
  photoHtml,
  resultsHtml,
  speciesPanelHtml,
  type PhotoInfo,
  type SpeciesRow,
} from "../src/index.ts";
import { SPECIES } from "../src/pilot-data.ts";
// Tests carry no literal remote URLs (check:no-network).
const HTTPS = "https:" + "//";

const row = (id: string): SpeciesRow => {
  const r = SPECIES.find((s) => s.id === id);
  assert.ok(r);
  return r;
};
const photo: PhotoInfo = {
  thumbUrl: "/t.jpg",
  pageUrl: "/page",
  licence: "CC BY 4.0",
  licenceUrl: "/licence",
  author: "A. Gardener",
};
const none = new Map<string, PhotoInfo>();
const rooms = [{ id: "r1", name: "Kitchen" }];

describe("photoHtml", () => {
  it("shows the photo with licence and author, linked to the Commons page", () => {
    const h = photoHtml(photo, "Monstera");
    assert.match(h, /<img[^>]+src="\/t\.jpg"/);
    assert.match(h, /alt="Monstera"/);
    assert.match(h, /CC BY 4\.0/);
    assert.match(h, /A\. Gardener/);
    assert.match(h, /href="\/page"/);
  });

  it("shows a plain placeholder, not a broken image, when there is no photo", () => {
    const h = photoHtml(undefined, "Monstera");
    assert.doesNotMatch(h, /<img/);
    assert.match(h, /no photo/i);
  });

  it("labels OpenPlantbook images as rights unconfirmed", () => {
    const h = photoHtml(
      { ...photo, licence: "image rights unconfirmed", author: "OpenPlantbook" },
      "x",
    );
    assert.match(h, /image rights unconfirmed/);
  });

  it("escapes what it is given", () => {
    const h = photoHtml({ ...photo, author: "<script>x</script>" }, 'a"b');
    assert.doesNotMatch(h, /<script>/);
    assert.doesNotMatch(h, /alt="a"b"/);
  });
});

describe("resultsHtml", () => {
  it("lists catalogue hits as options with the common name, scientific name and photo", () => {
    const m = row("monstera-deliciosa");
    const h = resultsHtml([{ kind: "catalogue", row: m }], new Map([[m.photoFile ?? "", photo]]));
    assert.match(h, /role="listbox"/);
    assert.match(h, /role="option"/);
    assert.match(h, /data-action="pick"/);
    assert.match(h, /data-id="monstera-deliciosa"/);
    assert.match(h, /Monstera deliciosa/);
    assert.match(h, /<img/);
  });

  it("marks OpenPlantbook hits as such and gives them no photo yet", () => {
    const h = resultsHtml([{ kind: "opb", pid: "x y", name: "X y", category: "Fam, X" }], none);
    assert.match(h, /data-kind="opb"/);
    assert.match(h, /OpenPlantbook/);
    assert.doesNotMatch(h, /<img/);
  });

  it("says so when nothing matches, and offers to use the typed text as the species", () => {
    const h = resultsHtml([], none, "blorp");
    assert.match(h, /No match/i);
    assert.match(h, /data-action="use-text"/);
    assert.match(h, /blorp/);
  });

  it("renders nothing for an empty query", () => {
    assert.equal(resultsHtml([], none, ""), "");
  });
});

describe("speciesPanelHtml (selected species and look-alikes)", () => {
  it("shows the selected species with its photo and care summary", () => {
    const m = row("monstera-deliciosa");
    const h = speciesPanelHtml(
      { kind: "catalogue", row: m },
      SPECIES,
      new Map([[m.photoFile ?? "", photo]]),
    );
    assert.match(h, /Monstera deliciosa/);
    assert.match(h, /<img/);
    assert.match(h, /Toxic to/);
  });

  it("shows the 'Not sure?' control with look-alikes, the tell, and a switch button for catalogue ones", () => {
    const p = row("pilea-peperomioides");
    const h = speciesPanelHtml({ kind: "catalogue", row: p }, SPECIES, none);
    assert.match(h, /Not sure\? Plants with similar names or looks/);
    assert.match(h, /data-action="pick"[^>]*data-id="crassula-ovata"/);
    assert.match(h, /peltate|perfectly round/i);
  });

  it("shows the toxicity/care warning when a look-alike matters", () => {
    const p = row("pilea-peperomioides");
    assert.match(speciesPanelHtml({ kind: "catalogue", row: p }, SPECIES, none), /TOXIC/);
  });

  it("repeats a shared 'tell' text once, not once per look-alike", () => {
    const p = row("pilea-peperomioides");
    const h = speciesPanelHtml({ kind: "catalogue", row: p }, SPECIES, none);
    const tell = p.lookAlikes?.[0]?.tell ?? "";
    assert.ok(tell.length > 0);
    assert.equal(h.split(tell.slice(0, 30)).length - 1, 1);
  });

  it("marks a species with no look-alikes recorded as not researched, not as 'none'", () => {
    const t = row("tillandsia");
    const h = speciesPanelHtml({ kind: "catalogue", row: t }, SPECIES, none);
    assert.match(h, /not researched yet|no look-alikes recorded/i);
    assert.doesNotMatch(h, /no look-alikes\b(?! recorded)/i);
  });

  it("has nothing to say about free text or before a pick", () => {
    assert.equal(speciesPanelHtml(undefined, SPECIES, none), "");
    assert.match(speciesPanelHtml({ kind: "text", text: "Mystery" }, SPECIES, none), /Mystery/);
  });
});

describe("careDetailsHtml", () => {
  const f = { style: "let_top_dry", intervalDays: "7", source: "catalogue: x" };

  it("is collapsed by default and says where the values come from", () => {
    const h = careDetailsHtml(f, { open: false, from: "Monstera deliciosa" });
    assert.match(h, /<details(?![^>]*\sopen)/);
    assert.match(h, /Care details \(from Monstera deliciosa, edit if needed\)/);
  });

  it("is open and says the values are required for a plant we do not know", () => {
    const h = careDetailsHtml({}, { open: true });
    assert.match(h, /<details[^>]*\sopen/);
    assert.match(h, /required/i);
  });

  it("keeps every care field the engine needs", () => {
    const h = careDetailsHtml(f, { open: false, from: "x" });
    for (const n of ["style", "intervalDays", "restFactor", "dryTolDays", "wetTolDays", "source"])
      assert.ok(h.includes(`name="${n}"`), n);
  });

  it("shows tags and toxicity read-only when the species is known", () => {
    const m = row("monstera-deliciosa");
    const h = careDetailsHtml(f, { open: false, from: m.name, species: m });
    assert.match(h, /indoor/);
    assert.match(h, /Toxic to/);
  });
});

describe("modalHtml", () => {
  const html = modalHtml({ fields: {}, rooms, title: "Add plant" });

  it("is a full-screen dialog with a big X at the top right", () => {
    assert.match(html, /<dialog[^>]*id="plant-modal"/);
    assert.match(
      html,
      /data-action="modal-close"[^>]*aria-label="Close"|aria-label="Close"[^>]*data-action="modal-close"/,
    );
  });

  it("has Save and Save for later fixed at the bottom", () => {
    const footer = html.slice(html.indexOf("<footer"));
    assert.match(footer, /Save for later/);
    assert.match(footer, />Save</);
    assert.ok(html.indexOf("Save for later") > html.indexOf('name="plantName"'));
  });

  it("orders the visible form: search, species, name, room, pot size, last watered, care details", () => {
    const at = (s: string): number => html.indexOf(s);
    const order = [
      'name="speciesSearch"',
      'id="species-panel"',
      'name="plantName"',
      'name="roomId"',
      'name="potDiameterCm"',
      'name="lastWatered"',
      "Care details",
    ].map(at);
    assert.ok(
      order.every((n) => n > 0),
      order.join(),
    );
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    );
  });

  it("the search box is a combobox with a listbox of suggestions", () => {
    assert.match(html, /role="combobox"/);
    assert.match(html, /aria-controls="species-results"/);
    assert.match(html, /id="species-results"/);
  });

  it("every labelled field says required or optional", () => {
    for (const m of html.matchAll(/<label>([^<]*?)<(?:input|select)/g))
      assert.match(m[1] ?? "", /\((required|optional)\)/, String(m[1]));
  });

  it("offers Randomise name and the room list", () => {
    assert.match(html, /data-action="randomise"/);
    assert.match(html, /<option value="r1"/);
  });

  it("fills in the fields it is given and escapes them", () => {
    const h = modalHtml({
      fields: { plantName: 'Mo"nty', potDiameterCm: "14", lastWatered: "2026-10-30", roomId: "r1" },
      rooms,
      title: "Edit",
    });
    assert.match(h, /value="Mo&#34;nty"/);
    assert.match(h, /value="14"/);
    assert.match(h, /<option value="r1" selected/);
  });
});

describe("draftsHtml", () => {
  it("lists drafts with Resume and Delete, labelled by name or species", () => {
    const h = draftsHtml([
      { id: "d1", savedOn: "2026-10-28", fields: { plantName: "Monty" } },
      { id: "d2", savedOn: "2026-10-28", fields: { species: "Aloe vera" } },
      { id: "d3", savedOn: "2026-10-28", fields: {} },
    ]);
    assert.match(h, /Drafts/);
    assert.match(h, /Monty/);
    assert.match(h, /Aloe vera/);
    assert.match(h, /Unnamed draft/);
    assert.equal(h.match(/data-action="resume-draft"/g)?.length, 3);
    assert.equal(h.match(/data-action="delete-draft"/g)?.length, 3);
    assert.match(h, /not scheduled/i);
  });

  it("is empty when there are no drafts", () => {
    assert.equal(draftsHtml([]), "");
  });
});

describe("app.ts wiring (source checks)", () => {
  const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/plant-modal.ts", import.meta.url), "utf8");
  const plants = src.slice(
    src.indexOf("function plantsSection"),
    src.indexOf("function roomsSection"),
  );

  it("the Plants tab keeps the grid and an Add plant button, with no inline form", () => {
    assert.match(plants, /data-action="add-plant"/);
    assert.doesNotMatch(plants, /plantForm\(/);
    assert.doesNotMatch(plants, /<form/);
  });

  it("the modal is opened with showModal (focus trap, Esc) and Esc asks before losing changes", () => {
    assert.match(controller, /showModal\(\)/);
    assert.match(controller, /"cancel"/);
    assert.match(controller, /hasUnsavedChanges/);
  });

  it("Randomise draws from the selected species and remembers names used this session", () => {
    assert.match(controller, /nextName\(/);
    assert.match(controller, /usedNames/);
  });

  it("species lookups go through the providers package, never a datalist", () => {
    assert.doesNotMatch(src + controller, /datalist/);
    assert.match(controller, /@green-garden\/providers/);
    assert.match(controller, /searchSpecies\(/);
  });
});

describe("pot size chips and the advanced fold (D-03)", () => {
  const html = modalHtml({ fields: {}, rooms, title: "Add plant" });
  const chips = [...html.matchAll(/data-action="pot-chip" data-cm="(\d+)"/g)].map((m) => m[1]);

  it("offers the six diameter chips, outside the advanced fold", () => {
    assert.deepEqual(chips, ["8", "12", "15", "20", "25", "30"]);
    const fold = html.indexOf('id="pot-advanced"');
    assert.ok(fold > html.lastIndexOf('data-action="pot-chip"'), "chips come before the fold");
  });

  it("keeps exact diameter, height and the pot type inside the fold", () => {
    const fold = html.slice(html.indexOf('id="pot-advanced"'));
    assert.match(fold, /name="potDiameterCm"/);
    assert.match(fold, /name="potHeightCm"/);
    assert.match(fold, /name="drainage"/);
    for (const v of ["hole", "cachepot", "no_hole", "self_watering"])
      assert.match(fold, new RegExp(`value="${v}"`));
  });

  it("opens the fold when a height or a pot type is already set, and marks the chosen chip", () => {
    const open = modalHtml({
      fields: { potDiameterCm: "15", potHeightCm: "12", drainage: "no_hole" },
      rooms,
      title: "x",
    });
    assert.match(open, /<details id="pot-advanced" open/);
    assert.match(open, /data-cm="15"[^>]*aria-pressed="true"/);
    assert.match(open, /<option value="no_hole" selected/);
    assert.doesNotMatch(html, /<details id="pot-advanced" open/);
  });
});

describe("Learn more links and 'Not sure what it is?'", () => {
  const link = (url: string, lang: string, kind: "care" | "toxicity" = "care") => ({
    url,
    title: `Page ${lang}`,
    publisher: `Site ${lang}`,
    lang,
    kind,
  });
  const withLinks = (): SpeciesRow => ({
    ...row("monstera-deliciosa"),
    links: [
      link(`${HTTPS}en.example/a`, "en"),
      link(`${HTTPS}aspca.example/a`, "en", "toxicity"),
      link(`${HTTPS}es.example/a`, "es"),
    ],
  });
  afterEach(() => {
    setLocale("en-GB");
  });

  it("lists the English links in a 'Learn more' section for an English reader", () => {
    const h = speciesPanelHtml({ kind: "catalogue", row: withLinks() }, SPECIES, none);
    assert.match(h, /Learn more/);
    assert.match(h, /href="https:\/\/en\.example\/a"[^>]*rel="noopener noreferrer"/);
    assert.doesNotMatch(h, /es\.example/);
    assert.doesNotMatch(h, /in English/);
  });

  it("shows a Spanish reader the Spanish page, and the English-only kind marked 'in English'", () => {
    setLocale("es");
    const h = speciesPanelHtml({ kind: "catalogue", row: withLinks() }, SPECIES, none);
    assert.match(h, /href="https:\/\/es\.example\/a"/);
    assert.doesNotMatch(h, /en\.example/);
    assert.match(h, /aspca\.example[\s\S]*en inglés/);
  });

  it("leaves the section out for a plant with no links", () => {
    const bare: SpeciesRow = { ...row("monstera-deliciosa") };
    delete (bare as { links?: unknown }).links;
    assert.doesNotMatch(
      speciesPanelHtml({ kind: "catalogue", row: bare }, SPECIES, none),
      /Learn more/,
    );
  });

  it("offers a reverse image search where nothing matched", () => {
    const h = resultsHtml([], none, "blorp");
    assert.match(h, /Not sure what it is\?/);
    assert.match(h, /href="https:\/\/lens\.google\.com\/"[^>]*rel="noopener noreferrer"/);
    assert.match(h, /any reverse image search works/i);
  });
});

describe("bundled catalogue photos", () => {
  const bundled: SpeciesRow = {
    ...row("aloe-vera"),
    photo: {
      file: "Aloe vera.jpg",
      creator: "J. Doe",
      licence: "CC-BY-SA-3.0",
      licenceUrl: HTTPS + "creativecommons.org/licenses/by-sa/3.0",
      sourceUrl: HTTPS + "commons.wikimedia.org/wiki/File:Aloe_vera.jpg",
      thumbnail: "aloe-vera.webp",
    },
  };

  it("the thumbnail is wrapped in a link to the Commons page", () => {
    const h = photoHtml(photo, "Monstera");
    assert.match(h, /<a href="\/page"[^>]*><img/);
  });

  it("a full-photo URL becomes data-full, escaped", () => {
    const h = photoHtml({ ...photo, fullUrl: "/f.jpg?a=1&b=2" }, "Monstera");
    assert.match(h, /data-full="\/f\.jpg\?a=1&#38;b=2"/);
    assert.doesNotMatch(photoHtml(photo, "Monstera"), /data-full/);
  });

  it("the species card uses the bundled thumbnail, the stored credit and a full photo at 800 px", () => {
    const h = speciesPanelHtml({ kind: "catalogue", row: bundled }, [bundled], none);
    assert.match(h, /src="\/catalogue-thumbs\/aloe-vera\.webp"/);
    assert.match(h, /J\. Doe/);
    assert.match(h, /CC BY-SA 3\.0/);
    assert.match(h, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Aloe_vera\.jpg"/);
    assert.match(h, /data-full="[^"]*Special:FilePath\/Aloe_vera\.jpg\?width=800"/);
  });

  it("search results show the bundled thumbnail without loading the full photo", () => {
    const h = resultsHtml([{ kind: "catalogue", row: bundled }], none);
    assert.match(h, /src="\/catalogue-thumbs\/aloe-vera\.webp"/);
    assert.doesNotMatch(h, /data-full/);
  });

  it("a bundled thumbnail wins over the runtime Commons lookup", () => {
    const h = speciesPanelHtml(
      { kind: "catalogue", row: bundled },
      [bundled],
      new Map([["Aloe vera.jpg", photo]]),
    );
    assert.doesNotMatch(h, /src="\/t\.jpg"/);
  });
});
