// SPDX-License-Identifier: AGPL-3.0-only

/** Translation helpers for the DOM layer. */
import { t, type Params } from "@green-garden/i18n";

export { t } from "@green-garden/i18n";

export function esc(s: string | number | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/**
 * A message for use inside HTML: string arguments are escaped, the message text is trusted (it comes
 * from the repo's own locale files and may carry `<strong>`/`<em>`).
 */
export function tHtml(key: string, params: Params = {}): string {
  const safe: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) safe[k] = typeof v === "string" ? esc(v) : v;
  return t(key, safe);
}
