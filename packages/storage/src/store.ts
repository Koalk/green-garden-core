// SPDX-License-Identifier: AGPL-3.0-only

import { VERSION, exportData, importData, type ImportIssue } from "./exchange.ts";
import { emptyData, type AppData } from "./model.ts";

/** Everything the app needs from persistence. A server-backed implementation can come later. */
export interface Store {
  load(): AppData;
  save(data: AppData): void;
}

/** The subset of the browser's `Storage` that is used, so tests need no DOM. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements Store {
  private data: AppData;
  constructor(initial: AppData = emptyData()) {
    this.data = initial;
  }
  load(): AppData {
    return this.data;
  }
  save(data: AppData): void {
    this.data = data;
  }
}

/** What the last `load` found, for the UI to tell the user. */
export interface LoadReport {
  readonly issues: readonly ImportIssue[];
  /** Where the old text was copied because it could not be read or is newer than this build. */
  readonly backupKey?: string;
  /** The stored file's version when it is higher than this build's. */
  readonly newerVersion?: number;
}

/** Compact UTC stamp for a backup key: 20261110T093015Z. */
function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/[.][0-9]+/, "");
}

/**
 * Browser-local store: one JSON document under one key, in the X5 format.
 *
 * Loading a store is not importing a file: plants that fail validation are kept and marked, and
 * on a fatal problem (unparseable text, a version higher than this build's) the old text is copied to
 * `<key>.backup-<timestamp>` before anything can be saved. A newer file is read but not overwritten
 * until `confirmOverwrite()` is called. A failed save throws.
 */
export class BrowserStore implements Store {
  private readonly kv: KeyValue;
  private readonly key: string;
  private readonly now: () => Date;
  private locked = false;
  /** Set by every `load`. */
  lastLoad?: LoadReport;
  constructor(kv: KeyValue, key = "green-garden", now: () => Date = () => new Date()) {
    this.kv = kv;
    this.key = key;
    this.now = now;
  }
  load(): AppData {
    const text = this.kv.getItem(this.key);
    this.locked = false;
    if (text === null) {
      this.lastLoad = { issues: [] };
      return emptyData();
    }
    const res = importData(text, { keepInvalid: true });
    const unreadable = res.issues.some(
      (i) => i.code === "import.notJson" || i.code === "import.notExport",
    );
    const newer = res.version !== undefined && res.version > VERSION ? res.version : undefined;
    let backupKey: string | undefined;
    if (unreadable || newer !== undefined) {
      backupKey = `${this.key}.backup-${stamp(this.now())}`;
      this.kv.setItem(backupKey, text);
      this.locked = newer !== undefined;
    }
    this.lastLoad = {
      issues: res.issues,
      ...(backupKey === undefined ? {} : { backupKey }),
      ...(newer === undefined ? {} : { newerVersion: newer }),
    };
    return res.data;
  }
  /** Allows saving over a file written by a newer version (the user was asked; the backup exists). */
  confirmOverwrite(): void {
    this.locked = false;
  }
  save(data: AppData): void {
    if (this.locked) {
      throw new Error("the stored data is from a newer version; confirm before overwriting it");
    }
    this.kv.setItem(this.key, exportData(data));
  }
}
