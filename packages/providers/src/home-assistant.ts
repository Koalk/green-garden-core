// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Home Assistant areas as a source of rooms (first slice of X1). The adapter talks to Home Assistant's
 * REST `POST /api/template` endpoint with a long-lived token; only the dev server (Node) holds the token and
 * calls it. The browser asks the dev server's local proxy through `ProxyAreas`.
 *
 * REST rather than the WebSocket `config/area_registry/list`: one request, no handshake or message ids, the
 * same `fetch` shape the other providers use, and a recorded text answer is an easy fixture. The registry
 * call would add floors and icons, which rooms do not need yet.
 */
import { isObj, str, type Fetcher } from "./http.ts";

export interface Area {
  /** Home Assistant's area id, kept on an imported room for sensor mapping later. */
  readonly id: string;
  readonly name: string;
}

export type AreaFailure = "not_configured" | "unauthorised" | "unreachable" | "bad_response";

export type AreaResult =
  | { readonly ok: true; readonly areas: readonly Area[] }
  | { readonly ok: false; readonly reason: AreaFailure };

/** Anything that can list areas: Home Assistant now, other home systems later. */
export interface AreaSource {
  listAreas(): Promise<AreaResult>;
}

/** The template Home Assistant renders into a JSON list of `{id, name}`. */
export const HA_AREAS_TEMPLATE =
  "{% set ns = namespace(a=[]) %}{% for id in areas() %}" +
  "{% set ns.a = ns.a + [{'id': id, 'name': area_name(id)}] %}{% endfor %}{{ ns.a | tojson }}";

/** Reads the template output. Anything that is not a list of areas gives nothing; sorted by name. */
export function parseHaAreas(text: string): Area[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Area[] = [];
  for (const r of raw as unknown[]) {
    const id = isObj(r) ? str(r["id"]) : undefined;
    const name = isObj(r) ? str(r["name"]) : undefined;
    if (id === undefined || name === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name.trim() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** `fetch`-shaped for a POST. The dev server passes `fetch`; tests pass recorded answers. */
export type Poster = (
  url: string,
  init: { readonly headers: Record<string, string>; readonly body: string },
) => Promise<PostResult>;

/** `http(s)://host[:port][/path]` without a trailing slash, or undefined. (No `URL`: this package has no DOM or Node types.) */
function baseOf(url: string | undefined): string | undefined {
  const m = /^(https?):\/\/([^/\s?#@]+)((?:\/[^\s?#]*)?)$/i.exec((url ?? "").trim());
  if (m === null) return undefined;
  return `${(m[1] ?? "").toLowerCase()}://${m[2] ?? ""}${(m[3] ?? "").replace(/\/+$/, "")}`;
}

export class HomeAssistantAreas implements AreaSource {
  private readonly base: string | undefined;
  private readonly token: string | undefined;
  private readonly post: Poster;
  constructor(baseUrl: string | undefined, token: string | undefined, post: Poster) {
    this.base = baseOf(baseUrl);
    this.token = token === undefined || token.trim() === "" ? undefined : token.trim();
    this.post = post;
  }

  async listAreas(): Promise<AreaResult> {
    if (this.base === undefined || this.token === undefined) {
      return { ok: false, reason: "not_configured" };
    }
    let res: PostResult;
    try {
      res = await this.post(`${this.base}/api/template`, {
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ template: HA_AREAS_TEMPLATE }),
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorised" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const text = await res.text();
    try {
      if (!Array.isArray(JSON.parse(text))) return { ok: false, reason: "bad_response" };
    } catch {
      return { ok: false, reason: "bad_response" };
    }
    return { ok: true, areas: parseHaAreas(text) };
  }
}

const PROXY_AREAS = "/api/homeassistant/areas";
const REASONS: readonly AreaFailure[] = ["not_configured", "unauthorised"];

/** The browser side: asks the dev server's proxy, which holds the address and the token. */
export class ProxyAreas implements AreaSource {
  private readonly fetcher: Fetcher;
  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async listAreas(): Promise<AreaResult> {
    try {
      const res = await this.fetcher(PROXY_AREAS);
      const json = await res.json();
      if (res.ok) {
        if (!isObj(json) || !Array.isArray(json["areas"]))
          return { ok: false, reason: "bad_response" };
        return { ok: true, areas: parseHaAreas(JSON.stringify(json["areas"])) };
      }
      const error = isObj(json) ? json["error"] : undefined;
      return { ok: false, reason: REASONS.find((r) => r === error) ?? "unreachable" };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}
