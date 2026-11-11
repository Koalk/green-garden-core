// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reference photos from Wikimedia Commons (features/01d). The browser fetches them at runtime; nothing
 * is bundled. Only licences that allow commercial use with attribution are kept (CC0, CC BY, CC BY-SA,
 * public domain), and the creator and licence are returned so the UI can show them.
 */
import { isObj, str, type Fetcher, type KeyValue } from "./http.ts";

export interface CommonsPhoto {
  readonly file: string;
  readonly thumbUrl: string;
  readonly pageUrl: string;
  readonly licence: string;
  readonly licenceUrl?: string;
  readonly author: string;
}

const API = "https://commons.wikimedia.org/w/api.php";
const CACHE_KEY = "green-garden-commons";
const THUMB_WIDTH = 320;

/** One API call for up to 50 files. */
export function commonsInfoRequest(files: readonly string[]): string {
  const titles = files.map((f) => `File:${f}`).join("|");
  const params = [
    "action=query",
    "format=json",
    "origin=*",
    "prop=imageinfo",
    `iiprop=${encodeURIComponent("url|extmetadata")}`,
    `iiextmetadatafilter=${encodeURIComponent("Artist|LicenseShortName|LicenseUrl")}`,
    `iiurlwidth=${String(THUMB_WIDTH)}`,
    `titles=${encodeURIComponent(titles)}`,
  ];
  return `${API}?${params.join("&")}`;
}

/** CC0, CC BY, CC BY-SA, public domain. Anything else (NC, ND, GFDL-only, unknown) is refused. */
function allowedLicence(short: string): boolean {
  const s = short.toLowerCase();
  if (/\b(nc|nd)\b/.test(s)) return false;
  return /^(cc0|cc[ -]by(-sa)?\b|public domain|pd\b)/.test(s);
}

const asHttps = (u: string): string => u.replace(/^http:\/\//, "https://");

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(m: unknown, key: string): string | undefined {
  return isObj(m) && isObj(m[key]) ? str(m[key]["value"]) : undefined;
}

/** File name (without "File:", spaces not underscores) to photo. Files that are missing or not freely licensed are left out. */
export function parseCommonsInfo(json: unknown): Map<string, CommonsPhoto> {
  const out = new Map<string, CommonsPhoto>();
  const pages = isObj(json) && isObj(json["query"]) ? json["query"]["pages"] : undefined;
  if (!isObj(pages)) return out;
  for (const page of Object.values(pages)) {
    if (!isObj(page) || "missing" in page) continue;
    const title = str(page["title"]);
    const info = Array.isArray(page["imageinfo"]) ? (page["imageinfo"] as unknown[])[0] : undefined;
    if (title === undefined || !isObj(info)) continue;
    const file = title.replace(/^File:/, "").replace(/_/g, " ");
    const thumb = str(info["thumburl"]);
    const pageUrl = str(info["descriptionurl"]);
    const licence = meta(info["extmetadata"], "LicenseShortName");
    if (thumb === undefined || pageUrl === undefined || licence === undefined) continue;
    if (!allowedLicence(licence)) continue;
    const licenceUrl = meta(info["extmetadata"], "LicenseUrl");
    out.set(file, {
      file,
      thumbUrl: asHttps(thumb),
      pageUrl: asHttps(pageUrl),
      licence,
      ...(licenceUrl === undefined ? {} : { licenceUrl: asHttps(licenceUrl) }),
      author: plainText(meta(info["extmetadata"], "Artist") ?? "") || "unknown author",
    });
  }
  return out;
}

/** Looks photos up in the local cache first, then asks Commons once for the rest. */
export class CommonsPhotos {
  private readonly memory = new Map<string, CommonsPhoto>();
  private readonly fetcher: Fetcher;
  private readonly kv: KeyValue;
  private loaded = false;

  constructor(fetcher: Fetcher, kv: KeyValue) {
    this.fetcher = fetcher;
    this.kv = kv;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw: unknown = JSON.parse(this.kv.getItem(CACHE_KEY) ?? "{}");
      if (!isObj(raw)) return;
      for (const [file, v] of Object.entries(raw)) {
        const ok =
          isObj(v) &&
          ["thumbUrl", "pageUrl", "licence", "author"].every((k) => typeof v[k] === "string");
        if (ok) this.memory.set(file, v as unknown as CommonsPhoto);
      }
    } catch {
      /* a corrupted cache is the same as an empty one */
    }
  }

  private save(): void {
    try {
      this.kv.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(this.memory)));
    } catch {
      /* storage full or blocked: the photos still show this session */
    }
  }

  async get(files: readonly string[]): Promise<Map<string, CommonsPhoto>> {
    this.load();
    const wanted = [...new Set(files)];
    const missing = wanted.filter((f) => !this.memory.has(f));
    for (let i = 0; i < missing.length; i += 50) {
      try {
        const res = await this.fetcher(commonsInfoRequest(missing.slice(i, i + 50)));
        if (!res.ok) continue;
        for (const [file, photo] of parseCommonsInfo(await res.json()))
          this.memory.set(file, photo);
        this.save();
      } catch {
        /* offline: no photo, the UI shows a placeholder */
      }
    }
    const out = new Map<string, CommonsPhoto>();
    for (const f of wanted) {
      const p = this.memory.get(f);
      if (p !== undefined) out.set(f, p);
    }
    return out;
  }
}
