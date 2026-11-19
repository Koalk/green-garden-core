// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The held-back save behind Q-K0 and what "Not now" or Escape do to it. Kept out of
 * `app.ts` (which needs a page) so the cancel path can be tested.
 */
import type { AppData } from "@green-garden/storage";

export interface HomePending {
  next: AppData;
  message: string;
  then?: () => void;
  cancelled?: () => void;
}

/** The pending state for Q-K0 opened on its own (a placement chip): `done` learns how it ended. */
export function askHomePending(data: AppData, done: (answered: boolean) => void): HomePending {
  return {
    next: data,
    message: "",
    then: () => {
      done(true);
    },
    cancelled: () => {
      done(false);
    },
  };
}

/** "Not now" or Escape: tells whoever asked that nothing was answered. */
export function cancelHomePending(held: HomePending | undefined): void {
  held?.cancelled?.();
}
