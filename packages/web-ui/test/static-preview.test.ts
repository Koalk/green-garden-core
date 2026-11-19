// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import { isStaticPreview, previewBannerHtml, serverOnlyHtml } from "../src/index.ts";
import { settingsHtml } from "../src/settings-view.ts";

const flags = globalThis as { __GG_STATIC_PREVIEW__?: boolean };

afterEach(() => {
  delete flags.__GG_STATIC_PREVIEW__;
  setLocale("en-GB");
});

describe("static preview mode", () => {
  it("is off unless the build sets the flag", () => {
    assert.equal(isStaticPreview(), false);
    assert.equal(previewBannerHtml(), "");
    assert.equal(serverOnlyHtml("<p>x</p>"), "<p>x</p>");
    assert.match(settingsHtml(emptyData()), /data-form="weather"/);
  });

  it("hides every server-only block and says what a preview is", () => {
    flags.__GG_STATIC_PREVIEW__ = true;
    assert.equal(isStaticPreview(), true);
    assert.equal(serverOnlyHtml("<p>x</p>"), "");
    assert.doesNotMatch(settingsHtml(emptyData()), /data-form="weather"|id="weather"/);
    const banner = previewBannerHtml();
    assert.match(banner, /Preview/);
    assert.match(banner, /this browser/);
    assert.match(banner, /reminders/i);
  });
});
