// SPDX-License-Identifier: AGPL-3.0-only
// check-no-network: fixture-urls
// helpers of the photo fetch script. Saved answer fixtures only; nothing here touches the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWithPick, infoRequestUrl, parseInfo } from "./fetch-photos-lib.mjs";

const answer = {
  query: {
    normalized: [{ from: "File:A b.jpg", to: "File:A_b.jpg" }],
    pages: {
      1: {
        title: "File:A_b.jpg",
        imageinfo: [
          {
            descriptionurl: "https://commons.wikimedia.org/wiki/File:A_b.jpg",
            thumburl: "https://upload.wikimedia.org/x/640px-A_b.jpg",
            width: 3000,
            height: 4000,
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 3.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
              Artist: { value: '<a href="//x">Jane &amp; Co</a>' },
            },
          },
        ],
      },
      2: { title: "File:Gone.jpg", missing: "" },
      3: {
        title: "File:Nc.jpg",
        imageinfo: [{ extmetadata: { LicenseShortName: { value: "CC BY-NC 4.0" } } }],
      },
    },
  },
};
const asked = ["A b.jpg", "Gone.jpg", "Nc.jpg"];

test("request: one titles parameter, at most 50 files", () => {
  const u = new URL(infoRequestUrl(["A b.jpg", "C.jpg"]));
  assert.equal(u.searchParams.get("titles"), "File:A b.jpg|File:C.jpg");
  assert.equal(u.searchParams.get("iiprop"), "url|extmetadata|size");
  assert.throws(() => infoRequestUrl(Array.from({ length: 51 }, (_, i) => `${String(i)}.jpg`)));
});

test("parse: normalises licence, strips markup from the creator, maps normalised titles", () => {
  const got = parseInfo(answer, asked);
  assert.deepEqual(
    [got.get("A b.jpg").licence, got.get("A b.jpg").creator, got.get("A b.jpg").width],
    ["CC-BY-SA-3.0", "Jane & Co", 3000],
  );
  assert.equal(got.get("Gone.jpg").missing, true);
  assert.equal(got.get("Nc.jpg").licence, null);
});

test("compare: reports licence, creator and missing-file changes", () => {
  const pick = { licence: "CC-BY-SA-3.0", creator: "Jane & Co" };
  const got = parseInfo(answer, asked);
  assert.deepEqual(compareWithPick(pick, got.get("A b.jpg")), []);
  assert.deepEqual(compareWithPick({ ...pick, licence: "CC-BY-4.0" }, got.get("A b.jpg")), [
    "licence CC-BY-4.0 -> CC-BY-SA-3.0",
  ]);
  assert.deepEqual(compareWithPick(pick, got.get("Gone.jpg")), ["file missing on Commons"]);
  assert.match(compareWithPick(pick, got.get("Nc.jpg"))[0], /not allowed/);
});
