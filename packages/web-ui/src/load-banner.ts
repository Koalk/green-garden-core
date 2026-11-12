// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the page tells the person after loading the browser copy: a file written by a newer version
 * (or one that could not be read) gets a banner with two choices, and plants that could not be read
 * get a one-line notice. `LoadGate` is the save guard behind the choices; it lives here, away from
 * `app.ts` (which needs a page), so it can be tested.
 */
import { t } from "@green-garden/i18n";
import {
  invalidPlants,
  type AppData,
  type BrowserStore,
  type LoadReport,
} from "@green-garden/storage";
import { esc } from "./text.ts";

export interface LoadBannerState {
  readonly banner: "newer" | "unreadable" | undefined;
  readonly invalidCount: number;
  /** Where the old text was copied, for the banner text. */
  readonly backupKey?: string;
}

export function loadBannerState(report: LoadReport | undefined, data: AppData): LoadBannerState {
  const invalidCount = invalidPlants(data).length;
  const base = report?.backupKey === undefined ? {} : { backupKey: report.backupKey };
  if (report?.newerVersion !== undefined) return { banner: "newer", invalidCount, ...base };
  if (report?.backupKey !== undefined) return { banner: "unreadable", invalidCount, ...base };
  return { banner: undefined, invalidCount };
}

export function loadBannerHtml(state: LoadBannerState): string {
  const parts: string[] = [];
  if (state.banner !== undefined) {
    const copy = state.backupKey ?? "";
    parts.push(
      `<section role="alert" class="notice load-banner"><p>${esc(t(`loadBanner.${state.banner}`, { copy }))}</p>` +
        `<p><button type="button" data-action="load-overwrite">${esc(t("loadBanner.overwrite"))}</button> ` +
        `<button type="button" class="secondary" data-action="load-leave">${esc(t("loadBanner.leave"))}</button></p></section>`,
    );
  }
  if (state.invalidCount > 0) {
    parts.push(
      `<p role="status" class="notice load-invalid">${esc(t("loadBanner.invalid", { n: state.invalidCount }))}</p>`,
    );
  }
  return parts.join("");
}

/** Wraps the store: while a newer or unreadable file is unanswered or left alone, nothing is saved. */
export class LoadGate {
  private readonly store: BrowserStore;
  private held = false;
  /** "Leave it" was chosen: the banner goes, saving stays off. */
  bannerDismissed = false;
  constructor(store: BrowserStore) {
    this.store = store;
  }
  load(): AppData {
    const data = this.store.load();
    this.bannerDismissed = false;
    this.held = this.store.lastLoad?.newerVersion !== undefined;
    return data;
  }
  get readOnly(): boolean {
    return this.held;
  }
  get lastLoad(): LoadReport | undefined {
    return this.store.lastLoad;
  }
  /** "Keep a copy and overwrite": the copy was made at load, so saving can go ahead. */
  overwrite(): void {
    this.store.confirmOverwrite();
    this.held = false;
    this.bannerDismissed = true;
  }
  /** "Leave it": read-only, nothing is written. */
  leave(): void {
    this.bannerDismissed = true;
  }
  save(data: AppData): void {
    if (this.held) return;
    this.store.save(data);
  }
}
