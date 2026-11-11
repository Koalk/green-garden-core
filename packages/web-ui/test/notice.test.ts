// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTICE_MS, createNotice } from "../src/index.ts";

/** A hand-driven clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number): number => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: number): void => {
      timers.delete(id);
    },
    advance: (ms: number): void => {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

describe("transient notice (the 'Plant saved' banner never went away)", () => {
  it("stays on screen for 2 seconds", () => {
    assert.equal(NOTICE_MS, 2000);
  });

  it("shows the message, then drops it after a few seconds", () => {
    const clock = fakeClock();
    let changes = 0;
    const n = createNotice(clock.setTimer, clock.clearTimer, () => changes++);
    n.show("Plant saved.");
    assert.equal(n.text(), "Plant saved.");
    clock.advance(NOTICE_MS - 1);
    assert.equal(n.text(), "Plant saved.");
    clock.advance(1);
    assert.equal(n.text(), "");
    assert.equal(changes, 2, "re-rendered on show and on expiry");
  });

  it("clear() removes it at once (next action, tab change) and cancels the timer", () => {
    const clock = fakeClock();
    const n = createNotice(clock.setTimer, clock.clearTimer, () => undefined);
    n.show("Plant saved.");
    n.clear();
    assert.equal(n.text(), "");
    assert.equal(clock.pending(), 0);
  });

  it("a newer message restarts the countdown instead of inheriting the old one", () => {
    const clock = fakeClock();
    const n = createNotice(clock.setTimer, clock.clearTimer, () => undefined);
    n.show("one");
    clock.advance(NOTICE_MS - 100);
    n.show("two");
    clock.advance(200);
    assert.equal(n.text(), "two");
    clock.advance(NOTICE_MS);
    assert.equal(n.text(), "");
  });

  it("an empty message is a clear", () => {
    const clock = fakeClock();
    const n = createNotice(clock.setTimer, clock.clearTimer, () => undefined);
    n.show("x");
    n.show("");
    assert.equal(n.text(), "");
    assert.equal(clock.pending(), 0);
  });
});

describe("app.ts notice wiring", () => {
  const src = `${import.meta.dirname}/../src/app.ts`;
  it("goes through the transient notice and clears on tab change", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(src, "utf8");
    assert.doesNotMatch(text, /^let notice = /m, "no bare string state");
    assert.doesNotMatch(text, /^\s+notice = /m, "no direct assignment");
    assert.match(text, /hashchange[\s\S]{0,160}notice\.clear\(\)/);
  });
});
