// SPDX-License-Identifier: AGPL-3.0-only

/** How long a status message stays on screen. */
export const NOTICE_MS = 2000;

export interface Notice {
  text(): string;
  /** Show a message and restart the countdown; an empty message clears. */
  show(message: string): void;
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
  const stop = (): void => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const clear = (): void => {
    stop();
    message = "";
  };
  return {
    text: () => message,
    show(next) {
      stop();
      if (next === "") {
        clear();
        return;
      }
      message = next;
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
