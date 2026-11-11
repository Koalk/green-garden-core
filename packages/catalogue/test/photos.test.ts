// SPDX-License-Identifier: AGPL-3.0-only
// check-no-network: fixture-urls
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  commonsFilePageUrl,
  commonsFileUrl,
  normaliseCommonsLicence,
  PHOTO_SIZES,
} from "../src/index.ts";

describe("photo URLs come from the Commons file name only", () => {
  it("full photo: Special:FilePath with a width", () => {
    assert.equal(
      commonsFileUrl("Adiantum raddianum - Wilhelma Zoo - DSC01985.jpg", 800),
      "https://commons.wikimedia.org/wiki/Special:FilePath/Adiantum_raddianum_-_Wilhelma_Zoo_-_DSC01985.jpg?width=800",
    );
  });

  it("encodes quotes, parentheses and commas the way Commons expects", () => {
    assert.equal(
      commonsFileUrl("Xanthosoma sagittifolium 'Mickey Mouse' (Philippines).jpg", 320),
      "https://commons.wikimedia.org/wiki/Special:FilePath/Xanthosoma_sagittifolium_%27Mickey_Mouse%27_(Philippines).jpg?width=320",
    );
  });

  it("without a width the original comes back", () => {
    assert.equal(
      commonsFileUrl("Aglaonema (Chinese Evergreens).jpg"),
      "https://commons.wikimedia.org/wiki/Special:FilePath/Aglaonema_(Chinese_Evergreens).jpg",
    );
  });

  it("the file page", () => {
    assert.equal(
      commonsFilePageUrl("Adiantum raddianum, DSC01985.jpg"),
      "https://commons.wikimedia.org/wiki/File:Adiantum_raddianum,_DSC01985.jpg",
    );
  });

  it("rejects widths that are not positive integers", () => {
    assert.throws(() => commonsFileUrl("a.jpg", 0));
    assert.throws(() => commonsFileUrl("a.jpg", 12.5));
  });

  it("named sizes", () => {
    assert.deepEqual(PHOTO_SIZES, { thumb: 320, detail: 800 });
  });
});

describe("Commons licence names become stored licence ids", () => {
  const cases: [string, string][] = [
    ["CC0", "CC0-1.0"],
    ["CC BY 4.0", "CC-BY-4.0"],
    ["CC BY-SA 4.0", "CC-BY-SA-4.0"],
    ["CC BY 2.0", "CC-BY-2.0"],
    ["CC BY-SA 3.0", "CC-BY-SA-3.0"],
    ["CC BY-SA 3.0 de", "CC-BY-SA-3.0"],
    ["Public domain", "PDM-1.0"],
    ["Public Domain Mark 1.0", "PDM-1.0"],
  ];
  for (const [raw, id] of cases) {
    it(`${raw} -> ${id}`, () => {
      assert.equal(normaliseCommonsLicence(raw), id);
    });
  }

  it("refuses NC, ND, GFDL, unknown and unversioned", () => {
    for (const raw of ["CC BY-NC 4.0", "CC BY-ND 2.0", "GFDL", "Copyrighted free use", "CC BY"]) {
      assert.equal(normaliseCommonsLicence(raw), undefined, raw);
    }
  });
});

describe("photos in the catalogue entries are complete", () => {
  const dir = new URL("../../../catalogue-draft/", import.meta.url);
  const thumbs = new URL("../thumbs/", import.meta.url);
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const json = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
        entries: { id: string; photoFile?: string; photos: Record<string, string>[] }[];
      };
      return json.entries;
    });
  const withPhoto = entries.filter((e) => e.photos.length > 0);

  it("at least the picks are in (78 of 80, 2 had none)", () => {
    assert.ok(withPhoto.length >= 70, `only ${String(withPhoto.length)} entries have a photo`);
  });

  it("every photo has credit, licence, file page and a WebP thumbnail on disk", () => {
    for (const e of withPhoto) {
      for (const p of e.photos) {
        assert.ok(p["creator"] && p["licence"] && p["licenceUrl"] && p["sourceUrl"], e.id);
        assert.equal(p["sourceUrl"], commonsFilePageUrl(p["file"] ?? ""), e.id);
        const bytes = readFileSync(new URL(p["thumbnail"] ?? "missing", thumbs));
        assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF", e.id);
        assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP", e.id);
        assert.ok(bytes.length < 60_000, `${e.id} thumbnail is ${String(bytes.length)} bytes`);
      }
    }
  });

  it("photoFile (the runtime fallback) names the same Commons file", () => {
    for (const e of withPhoto) assert.equal(e.photoFile, e.photos[0]?.["file"], e.id);
  });

  it("no thumbnail file is orphaned", () => {
    const used = new Set(withPhoto.flatMap((e) => e.photos.map((p) => p["thumbnail"])));
    for (const f of readdirSync(thumbs)) assert.ok(used.has(f), f);
  });
});
