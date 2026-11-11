// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CommonsPhotos,
  commonsInfoRequest,
  openPlantbookDetail,
  openPlantbookSearch,
  parseCommonsInfo,
  parseOpenPlantbookDetail,
  parseOpenPlantbookSearch,
  type Fetcher,
  type KeyValue,
} from "../src/index.ts";

// Built in pieces: scripts/check-no-network.mjs bans literal remote URLs in test files.
const HTTPS = "https:" + "//";
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));
const respond =
  (body: unknown, ok = true): Fetcher =>
  () =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

describe("OpenPlantbook search", () => {
  it("parses the recorded search response", () => {
    const hits = parseOpenPlantbookSearch(fixture("opb-search-monstera.json"));
    assert.deepEqual(
      hits.map((h) => h.pid),
      ["monstera friedrichsthalii", "monstera deliciosa"],
    );
    const second = hits[1];
    assert.ok(second);
    assert.equal(second.name, "Monstera deliciosa");
    assert.equal(second.category, "Araceae, Monstera");
  });

  it("ignores junk and keeps the rest", () => {
    assert.deepEqual(parseOpenPlantbookSearch(null), []);
    assert.deepEqual(parseOpenPlantbookSearch({ results: "x" }), []);
    assert.equal(
      parseOpenPlantbookSearch({ results: [{ pid: "a b" }, { nope: 1 }, 3] })[0]?.name,
      "a b",
    );
  });

  it("asks the local proxy, never the service, and encodes the query", async () => {
    const seen: string[] = [];
    const f: Fetcher = (url) => {
      seen.push(url);
      return respond(fixture("opb-search-monstera.json"))(url);
    };
    const hits = await openPlantbookSearch("mon & stera", f);
    assert.equal(hits.length, 2);
    assert.equal(seen.length, 1);
    assert.ok(seen[0]?.startsWith("/api/openplantbook/search?"));
    assert.ok(seen[0]?.includes("alias=mon%20%26%20stera"));
  });

  it("gives an empty list, not an error, when the proxy says no (no key set)", async () => {
    assert.deepEqual(await openPlantbookSearch("x", respond({}, false)), []);
    const boom: Fetcher = () => Promise.reject(new Error("offline"));
    assert.deepEqual(await openPlantbookSearch("x", boom), []);
  });

  it("does not query for a blank search", async () => {
    let calls = 0;
    const f: Fetcher = (u) => {
      calls += 1;
      return respond({})(u);
    };
    assert.deepEqual(await openPlantbookSearch("  ", f), []);
    assert.equal(calls, 0);
  });
});

describe("OpenPlantbook detail", () => {
  const detail = {
    pid: "monstera deliciosa",
    display_pid: "Monstera deliciosa",
    category: "Araceae, Monstera",
    image_url: `${HTTPS}opb-img.example/monstera%20deliciosa.jpg`,
    image_source: "",
    image_license: "",
    min_temp: 12,
    max_temp: 32,
  };

  it("keeps the image url and says the image rights are unconfirmed when no licence is given", () => {
    const d = parseOpenPlantbookDetail(detail);
    assert.ok(d);
    assert.equal(d.imageUrl, detail.image_url);
    assert.equal(d.imageRights, "image rights unconfirmed");
  });

  it("only accepts an https image url", () => {
    assert.equal(
      parseOpenPlantbookDetail({ ...detail, image_url: "javascript:alert(1)" })?.imageUrl,
      undefined,
    );
  });

  it("fetches through the local proxy", async () => {
    const seen: string[] = [];
    const f: Fetcher = (url) => {
      seen.push(url);
      return respond(detail)(url);
    };
    const d = await openPlantbookDetail("monstera deliciosa", f);
    assert.equal(d?.name, "Monstera deliciosa");
    assert.ok(seen[0]?.startsWith("/api/openplantbook/detail?pid=monstera%20deliciosa"));
  });
});

describe("Wikimedia Commons photos", () => {
  const files = ["Monstera deliciosa 001.jpg", "Hoya carnosa (wax vines).jpg"];

  it("builds one request for many files, asking for thumbnails and licence data", () => {
    const url = commonsInfoRequest(files);
    assert.ok(url.startsWith(`${HTTPS}commons.wikimedia.org/w/api.php?`));
    assert.ok(url.includes("prop=imageinfo"));
    assert.ok(url.includes("origin=*"));
    assert.ok(url.includes(encodeURIComponent("File:Monstera deliciosa 001.jpg")));
    assert.ok(url.includes(encodeURIComponent("File:Hoya carnosa (wax vines).jpg")));
  });

  it("parses thumbnail, page, licence and author from the recorded response", () => {
    const info = parseCommonsInfo(fixture("commons-two-files.json"));
    const hoya = info.get("Hoya carnosa (wax vines).jpg");
    assert.ok(hoya);
    assert.match(hoya.thumbUrl, /^https/);
    assert.match(hoya.pageUrl, /^https/);
    assert.equal(hoya.licence, "CC0");
    assert.equal(hoya.author, "Muldoonsamuel");
    assert.ok((info.get("Monstera deliciosa 001.jpg")?.licence ?? "").length > 0);
  });

  it("strips HTML from the author and keeps licence links on https", () => {
    const info = parseCommonsInfo(fixture("commons-two-files.json"));
    assert.ok(info.size > 0);
    for (const v of info.values()) {
      assert.doesNotMatch(v.author, /[<>]/);
      assert.ok(v.licenceUrl === undefined || v.licenceUrl.startsWith("https"));
    }
  });

  it("drops files whose licence is not free for commercial use", () => {
    const nc = {
      query: {
        pages: {
          "1": {
            title: "File:X.jpg",
            imageinfo: [
              {
                thumburl: `${HTTPS}t.example/x.jpg`,
                descriptionurl: `${HTTPS}c.example/x`,
                extmetadata: {
                  LicenseShortName: { value: "CC BY-NC 4.0" },
                  Artist: { value: "A" },
                },
              },
            ],
          },
        },
      },
    };
    assert.equal(parseCommonsInfo(nc).size, 0);
  });

  it("drops missing files and junk", () => {
    const missing = { query: { pages: { "-1": { title: "File:Y.jpg", missing: "" } } } };
    assert.equal(parseCommonsInfo(missing).size, 0);
    assert.equal(parseCommonsInfo(undefined).size, 0);
  });

  function memory(): KeyValue & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
  }

  it("asks once for uncached files, then serves them from the cache", async () => {
    let calls = 0;
    const f: Fetcher = (u) => {
      calls += 1;
      return respond(fixture("commons-two-files.json"))(u);
    };
    const kv = memory();
    const first = await new CommonsPhotos(f, kv).get(files);
    assert.equal(first.size, 2);
    assert.equal(calls, 1);
    const again = await new CommonsPhotos(f, kv).get(files);
    assert.equal(again.size, 2);
    assert.equal(calls, 1, "second instance read the local storage cache");
  });

  it("a failed request gives no photos (the UI shows a placeholder) and is not cached", async () => {
    const kv = memory();
    const bad: Fetcher = () => Promise.reject(new Error("offline"));
    assert.equal((await new CommonsPhotos(bad, kv).get(files)).size, 0);
    assert.equal(kv.store.size, 0);
    const ok = respond(fixture("commons-two-files.json"));
    assert.equal((await new CommonsPhotos(ok, kv).get(files)).size, 2);
  });

  it("survives a corrupted cache", async () => {
    const kv = memory();
    kv.setItem("green-garden-commons", "{not json");
    const ok = respond(fixture("commons-two-files.json"));
    assert.equal((await new CommonsPhotos(ok, kv).get(files)).size, 2);
  });

  it("does not ask for nothing", async () => {
    let calls = 0;
    const f: Fetcher = (u) => {
      calls += 1;
      return respond({})(u);
    };
    assert.equal((await new CommonsPhotos(f, memory()).get([])).size, 0);
    assert.equal(calls, 0);
  });
});
