// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The small seam between the web UI and the optional server (D-27): which backend is chosen, the
 * revision bookkeeping around it, and the Settings block. The UI keeps rendering from its own copy of the
 * data and mirrors every change to the server when one is chosen; the browser copy stays as the cache.
 */
import type { Backend, BackendFailure } from "@green-garden/client";
import type { AppData } from "@green-garden/storage";
import { esc, t, tHtml } from "./text.ts";

/** Shown as the address field's hint; a URL, not language. */
const EXAMPLE_URL = "http://192.168.1.20:8080";

export const SYNC_KEY = "green-garden-server";

export interface SyncConfig {
  readonly url: string;
  readonly token: string;
}

interface SyncKv {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSyncConfig(kv: SyncKv): SyncConfig | undefined {
  try {
    const raw: unknown = JSON.parse(kv.getItem(SYNC_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    const url = o["url"];
    const token = o["token"];
    return typeof url === "string" && url !== "" && typeof token === "string" && token !== ""
      ? { url, token }
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveSyncConfig(kv: SyncKv, config: SyncConfig | undefined): void {
  if (config === undefined) kv.removeItem(SYNC_KEY);
  else kv.setItem(SYNC_KEY, JSON.stringify(config));
}

export type SyncStatus = "ok" | "conflict" | BackendFailure;

/** The locale key of the message to show for a status; none when all is well. */
export function syncMessageKey(status: SyncStatus): string | undefined {
  return status === "ok" ? undefined : `sync.${status}`;
}

export type Connected =
  | { readonly kind: "uploaded" }
  | { readonly kind: "remote"; readonly data: AppData }
  | { readonly kind: "failed"; readonly status: BackendFailure };

function failure(status: SyncStatus): BackendFailure {
  return status === "ok" || status === "conflict" ? "invalid" : status;
}

/** Tracks the revision the server last confirmed, so each save names the state it was based on. */
export class SyncSession {
  revision = 0;
  private readonly backend: Backend;
  constructor(backend: Backend) {
    this.backend = backend;
  }

  /** First contact: an empty server receives the local data; otherwise its data is offered to the caller. */
  async connect(local: AppData): Promise<Connected> {
    const r = await this.pull();
    if (r.kind !== "remote" || this.revision !== 0) return r;
    const saved = await this.push(local);
    return saved === "ok" ? { kind: "uploaded" } : { kind: "failed", status: failure(saved) };
  }

  /** The server's data and revision (the way out of a conflict). */
  async pull(): Promise<Connected> {
    const r = await this.backend.load();
    if (!r.ok) return { kind: "failed", status: r.reason };
    this.revision = r.revision;
    return { kind: "remote", data: r.data };
  }

  async push(data: AppData): Promise<SyncStatus> {
    const r = await this.backend.save(data, this.revision);
    if (r.ok) {
      this.revision = r.revision;
      return "ok";
    }
    return r.reason;
  }
}

/** The "Where your data lives" block of the Data tab. The token is never printed back. */
export function syncHtml(config: SyncConfig | undefined): string {
  if (config === undefined) {
    return `<h3>${esc(t("sync.heading"))}</h3><p>${esc(t("sync.localNote"))}</p>
    <form data-form="server">
    <label>${esc(t("sync.url"))} <input name="url" type="url" required autocomplete="off" placeholder="${EXAMPLE_URL}"></label>
    <label>${esc(t("sync.token"))} <input name="token" type="password" required autocomplete="off"></label>
    <button type="submit">${esc(t("sync.connect"))}</button></form>`;
  }
  return `<h3>${esc(t("sync.heading"))}</h3><p>${tHtml("sync.remoteNote", { url: config.url })}</p>
    <p><button data-action="server-pull">${esc(t("sync.pull"))}</button>
    <button data-action="server-off">${esc(t("sync.off"))}</button></p>`;
}
