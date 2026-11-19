// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "@green-garden/i18n";
import { BrowserStore, emptyData, exportData, VERSION, type KeyValue } from "@green-garden/storage";
import { LoadGate, loadBannerHtml, loadBannerState } from "../src/index.ts";

function kv(initial: Record<string, string> = {}): KeyValue & { m: Map<string, string> } {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

const newerText = (): string => {
  const o = JSON.parse(exportData(emptyData())) as Record<string, unknown>;
  o["version"] = VERSION + 1;
  return JSON.stringify(o);
};

describe("load banner", () => {
  it("shows nothing for a clean load", () => {
    const store = new BrowserStore(kv());
    const data = store.load();
    assert.deepEqual(loadBannerState(store.lastLoad, data), {
      banner: undefined,
      invalidCount: 0,
    });
    assert.equal(loadBannerHtml(loadBannerState(store.lastLoad, data)), "");
  });

  it("a file from a newer version gives the banner with both buttons", () => {
    const store = new BrowserStore(kv({ "green-garden": newerText() }));
    const data = store.load();
    const state = loadBannerState(store.lastLoad, data);
    assert.equal(state.banner, "newer");
    const html = loadBannerHtml(state);
    assert.match(html, /data-action="load-overwrite"/);
    assert.match(html, /data-action="load-leave"/);
    assert.ok(html.includes(t("loadBanner.newer", { copy: state.backupKey ?? "" })));
  });

  it("unreadable text gives the unreadable banner", () => {
    const store = new BrowserStore(kv({ "green-garden": "{nope" }));
    const data = store.load();
    assert.equal(loadBannerState(store.lastLoad, data).banner, "unreadable");
  });

  it("saving over a newer file throws until overwrite is confirmed, with a copy kept", () => {
    const k = kv({ "green-garden": newerText() });
    const store = new BrowserStore(k);
    const gate = new LoadGate(store);
    gate.load();
    assert.ok([...k.m.keys()].some((x) => x.startsWith("green-garden.backup-")));
    assert.equal(gate.readOnly, true);
    gate.save(emptyData());
    assert.equal(k.m.get("green-garden"), newerText(), "read-only: nothing written");
    gate.overwrite();
    assert.equal(gate.readOnly, false);
    gate.save(emptyData());
    assert.notEqual(k.m.get("green-garden"), newerText());
  });

  it("'Leave it' keeps the file untouched and saves stay off", () => {
    const k = kv({ "green-garden": newerText() });
    const gate = new LoadGate(new BrowserStore(k));
    gate.load();
    gate.leave();
    assert.equal(gate.readOnly, true);
    assert.equal(gate.bannerDismissed, true);
    gate.save(emptyData());
    assert.equal(k.m.get("green-garden"), newerText());
  });

  it("counts plants that could not be read, one line, in each language", () => {
    const text = exportData({
      ...emptyData(),
      plants: [{ id: "a", name: "ok" } as never, { id: "b", name: 5 } as never],
    });
    const store = new BrowserStore(kv({ "green-garden": text }));
    const data = store.load();
    const state = loadBannerState(store.lastLoad, data);
    assert.equal(state.invalidCount, data.plants.filter((p) => p.invalid !== undefined).length);
    const html = loadBannerHtml({ banner: undefined, invalidCount: 2 });
    assert.match(html, /2/);
    assert.ok(!html.includes("<button"), "the notice has no buttons");
    for (const k of ["loadBanner.newer", "loadBanner.unreadable", "loadBanner.invalid"]) {
      assert.notEqual(t(k, { n: 2, copy: "x" }), k);
    }
  });
});
