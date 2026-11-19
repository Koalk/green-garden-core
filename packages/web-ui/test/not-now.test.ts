// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import { askHomePending, cancelHomePending } from "../src/home-pending.ts";
import { placementAfterAsk } from "../src/placement.ts";

describe("Not now and Escape on a placement chip", () => {
  it("Not now or Escape: the cancel path reports 'not answered' and the chip goes back to Indoors", () => {
    const seen: boolean[] = [];
    const held = askHomePending(emptyData(), (a) => seen.push(a));
    cancelHomePending(held); // both "home-cancel" and the dialog's close event call this
    assert.deepEqual(seen, [false]);
    assert.equal(placementAfterAsk("indoor", "outdoor_pot", seen[0] ?? true), "indoor");
    assert.equal(placementAfterAsk("indoor", "ground", false), "indoor");
  });

  it("an answered Q-K0 keeps Pot outside", () => {
    const seen: boolean[] = [];
    const held = askHomePending(emptyData(), (a) => seen.push(a));
    held.then?.();
    assert.deepEqual(seen, [true]);
    assert.equal(placementAfterAsk("indoor", "outdoor_pot", true), "outdoor_pot");
  });

  it("cancelling goes back to the earlier outdoor chip, not Indoors", () => {
    assert.equal(placementAfterAsk("ground", "outdoor_pot", false), "ground");
  });

  it("nothing pending: cancel does nothing", () => {
    cancelHomePending(undefined);
  });
});
