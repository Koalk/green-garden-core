// SPDX-License-Identifier: AGPL-3.0-only

/** The part of a `Response` the providers use, so tests need no network and no DOM. */
export interface FetchResult {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The request options the providers use (a subset of `RequestInit`); most calls pass none. */
export interface FetchInit {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** `fetch`-shaped. The browser passes `window.fetch`; tests pass recorded fixtures. */
export type Fetcher = (url: string, init?: FetchInit) => Promise<FetchResult>;

/** The subset of the browser's `Storage` that is used. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
