// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import { buildLabel } from "../src/build-info.ts";
import { settingsHtml } from "../src/settings-view.ts";
import { helpBody } from "../src/unreadable-view.ts";
import { handle } from "../dev/server.mjs";

const flags = globalThis as { __GG_BUILD__?: { commit: string; date: string } };
const plant = { id: "p1", name: "Fern", style: "nope" } as never;

afterEach(() => {
  delete flags.__GG_BUILD__;
  setLocale("en-GB");
});

describe("the web UI knows which build it is", () => {
  it("names the commit and the date the build set, and 'dev' when it set none", () => {
    assert.equal(buildLabel(), "dev");
    flags.__GG_BUILD__ = { commit: "abc1234", date: "2026-11-23" };
    assert.equal(buildLabel(), "abc1234 (2026-11-23)");
  });

  it("'Ask for help' names the build before the data format version", () => {
    flags.__GG_BUILD__ = { commit: "abc1234", date: "2026-11-23" };
    assert.match(
      helpBody(plant),
      /Green Garden web UI abc1234 \(2026-11-23\), data format version 11\./,
    );
  });

  it("Settings shows the same line in small text, in every language", () => {
    flags.__GG_BUILD__ = { commit: "abc1234", date: "2026-11-23" };
    for (const l of ["en-GB", "es", "it"]) {
      setLocale(l);
      assert.match(
        settingsHtml(emptyData()),
        /<small[^>]*>[^<]*abc1234 \(2026-11-23\)[^<]*<\/small>/,
      );
    }
  });

  it("the local server's page sets the build", async () => {
    const page = await handle("/");
    assert.match(page.body, /__GG_BUILD__\s*=\s*\{"commit":"[^"]+","date":"\d{4}-\d{2}-\d{2}"\}/);
  });
});
