// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Keyboard navigation and staleness for the species search. Focus stays in the search box;
 * the highlighted option is named by `aria-activedescendant`.
 */

/** Next highlighted index after an arrow key: -1 is "no option" (the box itself). */
export function nextActive(active: number, step: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (step > 0) return Math.min(active + 1, count - 1);
  if (active === -1) return count - 1;
  return active - 1;
}

/**
 * One search "session": every keystroke begins a new token. Closing (a pick, Esc, the modal) makes
 * every earlier token stale, so a debounced or slow answer never reopens a closed list.
 */
export class SearchSession {
  private seq = 0;
  begin(): number {
    this.seq += 1;
    return this.seq;
  }
  close(): void {
    this.seq += 1;
  }
  isCurrent(token: number): boolean {
    return token === this.seq;
  }
}
