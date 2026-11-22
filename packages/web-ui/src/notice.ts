// SPDX-License-Identifier: AGPL-3.0-only

/** How long a status message stays on screen. */
export const NOTICE_MS = 2000;

export interface Notice {
  text(): string;
  /** Show a message and restart the countdown; an empty message clears. */
  show(message: string, options?: { hold?: boolean }): void;
  /** True while the message is held: it stays until the next action instead of expiring. */
  held(): boolean;
  clear(): void;
}

/**
 * A transient status message. It expires on its own, and callers clear it on the next action or tab
 * change. The clock is injected so the behaviour is testable without a browser.
 */
export function createNotice(
  setTimer: (fn: () => void, ms: number) => number,
  clearTimer: (id: number) => void,
  onChange: () => void,
): Notice {
  let message = "";
  let timer: number | undefined;
  let hold = false;
  const stop = (): void => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const clear = (): void => {
    stop();
    message = "";
    hold = false;
  };
  return {
    text: () => message,
    held: () => hold,
    show(next, options) {
      stop();
      if (next === "") {
        clear();
        return;
      }
      message = next;
      hold = options?.hold === true;
      if (hold) {
        onChange();
        return;
      }
      timer = setTimer(() => {
        timer = undefined;
        message = "";
        onChange();
      }, NOTICE_MS);
      onChange();
    },
    clear,
  };
}
