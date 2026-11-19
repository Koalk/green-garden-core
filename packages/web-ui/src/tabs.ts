// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The tabs and their URL anchors. The hash keeps the tab on reload and works with the back button.
 * Holidays became Planning; old `#holidays` links still land there.
 */
export type Tab = "today" | "plants" | "planning" | "settings" | "data";
export const TABS: readonly Tab[] = ["today", "plants", "planning", "settings", "data"];

/** Anchors that open a tab under another name: `#improve` is a view of Plants. */
const ALIASES: Readonly<Record<string, Tab>> = { improve: "plants", holidays: "planning" };

export function tabFromHash(hash: string): Tab {
  const h = hash.replace(/^#/, "");
  return ALIASES[h] ?? TABS.find((x) => x === h) ?? "today";
}

/** The anchor an old link should be rewritten to, or `undefined` when it is current. */
export function legacyHash(hash: string): string | undefined {
  return hash === "#holidays" ? "#planning" : undefined;
}
