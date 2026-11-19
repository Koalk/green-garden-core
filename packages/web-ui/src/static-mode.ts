// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The static preview: the same UI built with no server behind it (see `scripts/build-static.mjs`). The
 * build sets `globalThis.__GG_STATIC_PREVIEW__` before the app loads; everything that needs a server
 * (weather route, sync, reminders by email, Home Assistant, OpenPlantbook) is left out, not shown broken.
 */
import { esc, t } from "./text.ts";

export function isStaticPreview(): boolean {
  return (globalThis as { __GG_STATIC_PREVIEW__?: unknown }).__GG_STATIC_PREVIEW__ === true;
}

/** The block as given, or nothing in the preview. */
export function serverOnlyHtml(html: string): string {
  return isStaticPreview() ? "" : html;
}

/** The "Preview" label: data stays in this browser, reminders need the app. */
export function previewBannerHtml(): string {
  return isStaticPreview()
    ? `<p class="notice" role="note"><strong>${esc(t("preview.label"))}</strong> ${esc(t("preview.note"))}</p>`
    : "";
}
