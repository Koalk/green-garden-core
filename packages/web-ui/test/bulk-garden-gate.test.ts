// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import {
  advance,
  gardenGate,
  makeMatcher,
  pickCandidate,
  runMatch,
  setRowPlacement,
  startBulk,
  type BulkState,
} from "../src/bulk-flow.ts";
import { bulkDialogHtml } from "../src/bulk-view.ts";
import { SPECIES } from "../src/pilot-data.ts";

const matcher = makeMatcher(SPECIES, "en-GB");
const ctx = { rooms: [], photos: new Map(), data: emptyData(), today: "2026-11-12" };

function atVerify(placement: "indoor" | "outdoor_pot"): BulkState {
  const first = runMatch(startBulk("pothos"), matcher);
  const id = first.rows[0]?.id ?? "";
  const matched = pickCandidate(first, id, first.rows[0]?.candidates[0]?.id ?? "");
  return advance(advance(setRowPlacement(matched, id, placement)));
}

describe("bulk add and the garden question (Q-K0)", () => {
  it("is asked for an outdoor plant while no climate is set, not for an indoor one", () => {
    assert.equal(gardenGate(emptyData(), atVerify("outdoor_pot"), ctx.today).needed, true);
    assert.equal(gardenGate(emptyData(), atVerify("indoor"), ctx.today).needed, false);
  });

  it("dismissing it returns to the placement step with the list and placements kept, and says why", () => {
    const state = atVerify("outdoor_pot");
    const back = gardenGate(emptyData(), state, ctx.today).dismissed(state);
    assert.equal(back.step, "place");
    assert.deepEqual(back.rows, state.rows);
    assert.equal(back.text, state.text);
    const h = bulkDialogHtml(back, { ...ctx, gardenNote: true });
    assert.match(h, /need the garden question first/i);
    assert.match(
      h,
      /data-value="outdoor_pot"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-value="outdoor_pot"/,
    );
    assert.doesNotMatch(bulkDialogHtml(back, ctx), /garden question first/i);
  });
});
