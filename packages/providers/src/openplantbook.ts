// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenPlantbook search and detail. The browser never holds the API token: requests go to the dev
 * server's local proxy (`/api/openplantbook/...`), which adds it. Without a token the proxy answers
 * with an error and these functions return nothing, so the UI simply has no OpenPlantbook results.
 */
import { isObj, str, type Fetcher } from "./http.ts";

export interface OpenPlantbookHit {
  /** OpenPlantbook's id, e.g. "monstera deliciosa". */
  readonly pid: string;
  readonly name: string;
  readonly category?: string;
}

export interface OpenPlantbookDetail {
  readonly pid: string;
  readonly name: string;
  readonly category?: string;
  readonly imageUrl?: string;
  /** Always set: the licence OpenPlantbook gives, or "image rights unconfirmed". */
  readonly imageRights: string;
}

const PROXY = "/api/openplantbook";

export function parseOpenPlantbookSearch(json: unknown): OpenPlantbookHit[] {
  const list = isObj(json) && Array.isArray(json["results"]) ? (json["results"] as unknown[]) : [];
  const out: OpenPlantbookHit[] = [];
  for (const r of list) {
    const pid = isObj(r) ? str(r["pid"]) : undefined;
    if (!isObj(r) || pid === undefined) continue;
    const category = str(r["category"]);
    out.push({
      pid,
      name: str(r["display_pid"]) ?? pid,
      ...(category === undefined ? {} : { category }),
    });
  }
  return out;
}

export function parseOpenPlantbookDetail(json: unknown): OpenPlantbookDetail | undefined {
  if (!isObj(json)) return undefined;
  const pid = str(json["pid"]);
  if (pid === undefined) return undefined;
  const image = str(json["image_url"]);
  const category = str(json["category"]);
  const licence = str(json["image_license"]);
  return {
    pid,
    name: str(json["display_pid"]) ?? pid,
    ...(category === undefined ? {} : { category }),
    ...(image !== undefined && /^https:\/\//.test(image) ? { imageUrl: image } : {}),
    imageRights: licence ?? "image rights unconfirmed",
  };
}

async function getJson(url: string, fetcher: Fetcher): Promise<unknown> {
  try {
    const res = await fetcher(url);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function openPlantbookSearch(
  query: string,
  fetcher: Fetcher,
  limit = 8,
): Promise<OpenPlantbookHit[]> {
  const q = query.trim();
  if (q === "") return [];
  const url = `${PROXY}/search?alias=${encodeURIComponent(q)}&limit=${String(limit)}`;
  return parseOpenPlantbookSearch(await getJson(url, fetcher));
}

export async function openPlantbookDetail(
  pid: string,
  fetcher: Fetcher,
): Promise<OpenPlantbookDetail | undefined> {
  return parseOpenPlantbookDetail(
    await getJson(`${PROXY}/detail?pid=${encodeURIComponent(pid)}`, fetcher),
  );
}
