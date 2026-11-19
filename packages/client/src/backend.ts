// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the web UI keeps its data (D-27): `LocalBackend` wraps the browser storage and needs nothing;
 * `RemoteBackend` talks to the optional self-hosted server. Both speak the X5 export format
 * (`AppData` via `exportData`/`importData`, so `migrate()` runs on every load).
 *
 * The revision is a counter the server bumps on each save. A save names the revision it was based on;
 * if another device saved in between, the server answers 409 and the save reports a conflict instead of
 * overwriting. The local backend has one writer, so it never conflicts.
 */
import { exportData, importData, type AppData, type Store } from "@green-garden/storage";

export type BackendFailure = "unreachable" | "unauthorised" | "invalid";

export type LoadResult =
  | { readonly ok: true; readonly data: AppData; readonly revision: number }
  | { readonly ok: false; readonly reason: BackendFailure };

export type SaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: "conflict"; readonly revision: number }
  | { readonly ok: false; readonly reason: BackendFailure };

export interface Backend {
  load(): Promise<LoadResult>;
  /** `baseRevision` is the revision the data was last loaded or saved at. */
  save(data: AppData, baseRevision: number): Promise<SaveResult>;
}

/** The part of `fetch` that is used, so tests pass a fake and never touch the network. */
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export class LocalBackend implements Backend {
  private readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  load(): Promise<LoadResult> {
    return Promise.resolve({ ok: true, data: this.store.load(), revision: 0 });
  }
  save(data: AppData, baseRevision = 0): Promise<SaveResult> {
    this.store.save(data);
    return Promise.resolve({ ok: true, revision: baseRevision });
  }
}

export interface RemoteOptions {
  /** Server address, e.g. `http://192.168.1.20:8080`. */
  readonly url: string;
  /** Bearer token (GREEN_GARDEN_SERVER_TOKEN on the server). */
  readonly token: string;
  /** Which dataset on the server; defaults to `default`. */
  readonly space?: string;
  readonly fetchFn: FetchFn;
}

type Obj = Record<string, unknown>;

function parseObj(text: string): Obj | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : undefined;
  } catch {
    return undefined;
  }
}

function revisionOf(o: Obj | undefined): number | undefined {
  const r = o?.["revision"];
  return typeof r === "number" && Number.isInteger(r) && r >= 0 ? r : undefined;
}

export class RemoteBackend implements Backend {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchFn: FetchFn;
  constructor(options: RemoteOptions) {
    this.endpoint = `${options.url.replace(/\/+$/, "")}/api/spaces/${options.space ?? "default"}`;
    this.token = options.token;
    this.fetchFn = options.fetchFn;
  }

  private async call(
    method: string,
    extra: Record<string, string> = {},
    body?: string,
  ): Promise<{ status: number; json: Obj | undefined } | undefined> {
    try {
      const res = await this.fetchFn(this.endpoint, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...extra },
        ...(body === undefined ? {} : { body }),
      });
      return { status: res.status, json: parseObj(await res.text()) };
    } catch {
      return undefined;
    }
  }

  async load(): Promise<LoadResult> {
    const r = await this.call("GET");
    if (r === undefined) return { ok: false, reason: "unreachable" };
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "unauthorised" };
    const revision = revisionOf(r.json);
    if (r.status !== 200 || revision === undefined || r.json?.["data"] === undefined) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, data: importData(JSON.stringify(r.json["data"])).data, revision };
  }

  async save(data: AppData, baseRevision: number): Promise<SaveResult> {
    const r = await this.call(
      "PUT",
      { "content-type": "application/json", "if-match": String(baseRevision) },
      exportData(data),
    );
    if (r === undefined) return { ok: false, reason: "unreachable" };
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "unauthorised" };
    const revision = revisionOf(r.json);
    if (r.status === 409 && revision !== undefined) {
      return { ok: false, reason: "conflict", revision };
    }
    if (r.status !== 200 || revision === undefined) return { ok: false, reason: "invalid" };
    return { ok: true, revision };
  }
}
