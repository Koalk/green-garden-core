// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setLocale } from "@green-garden/i18n";
import { emptyData } from "@green-garden/storage";
import {
  advance,
  makeMatcher,
  pickCandidate,
  runMatch,
  setRowPlacement,
  setRowRoom,
  setText,
  setWatered,
  startBulk,
  toggleRow,
  type BulkState,
} from "../src/bulk-flow.ts";
import { bulkDialogHtml, notAddedHtml, type BulkViewContext } from "../src/bulk-view.ts";
import { SPECIES } from "../src/pilot-data.ts";

const matcher = makeMatcher(SPECIES, "en-GB");
const ctx: BulkViewContext = {
  rooms: [
    { id: "r1", name: "Kitchen" },
    { id: "r2", name: "Bedroom" },
  ],
  photos: new Map(),
  data: emptyData(),
  today: "2026-10-30",
};
const html = (s: BulkState, c: BulkViewContext = ctx): string => bulkDialogHtml(s, c);
const matched = (text: string): BulkState => runMatch(startBulk(text), matcher);

afterEach(() => {
  setLocale("en-GB");
});

describe("step 1: type", () => {
  it("shows a big text box holding the text, a live count and a disabled Match when empty", () => {
    const h = html(startBulk(""));
    assert.match(h, /<dialog id="bulk-modal"/);
    assert.match(h, /<textarea[^>]+name="bulkText"/);
    assert.match(h, /data-action="bulk-match"[^>]*disabled/);
    assert.match(h, /No plants yet/);
  });

  it("counts plants, not lines, and enables Match", () => {
    const h = html(startBulk("3x pothos\njade"));
    assert.match(h, /4 plants/);
    assert.match(h, />3x pothos\njade<\/textarea>/);
    assert.doesNotMatch(h, /data-action="bulk-match"[^>]*disabled/);
  });

  it("says when the earlier text came back from a draft", () => {
    assert.match(html(startBulk("jade"), { ...ctx, restored: true }), /earlier text/i);
  });

  it("escapes what was typed", () => {
    const h = html(startBulk("<img src=x onerror=alert(1)>"));
    assert.doesNotMatch(h, /<img src=x/);
  });

  it("offers the wording in Spanish", () => {
    setLocale("es");
    assert.doesNotMatch(html(startBulk("jade")), /Match names/);
  });
});

describe("step 2: match", () => {
  const s = matched("aloe vera\npothos\nxyzzy");

  it("groups sure, choose and unmatched with a summary", () => {
    const h = html(s);
    assert.match(h, /1 sure, 1 to check, 1 not found/);
    assert.match(h, /data-group="sure"/);
    assert.match(h, /data-group="choose"/);
    assert.match(h, /data-group="unmatched"/);
  });

  it("a sure row names the match and says why, collapsed and changeable", () => {
    const h = html(matched("monstra"));
    assert.match(h, /Swiss cheese plant/);
    assert.match(h, /Monstera deliciosa/);
    assert.match(h, /<details/);
  });

  it("a choose row lists the candidates as buttons with the look-alike tell", () => {
    const h = html(matched("pothos"));
    assert.match(h, /data-action="bulk-pick"[^>]+data-species="epipremnum-aureum"/);
    assert.match(h, /data-action="bulk-pick"[^>]+data-species="philodendron-hederaceum"/);
    assert.match(h, /class="tell"/);
  });

  it("an unmatched row can be retyped, added as a generic plant or removed", () => {
    const h = html(matched("xyzzy"));
    assert.match(h, /<input[^>]+name="retype"/);
    assert.match(h, /data-action="bulk-retype"/);
    assert.match(h, /data-action="bulk-generic"/);
    assert.match(h, /data-action="bulk-remove"/);
  });

  it("an unmatched row offers a reverse image search", () => {
    const h = html(matched("xyzzy"));
    assert.match(h, /Not sure what it is\?/);
    assert.match(h, /href="https:\/\/lens\.google\.com\/"/);
  });

  it("a picked candidate moves to the sure group", () => {
    const p = matched("pothos");
    const picked = pickCandidate(p, p.rows[0]?.id ?? "", "epipremnum-aureum");
    assert.match(html(picked), /1 sure, 0 to check, 0 not found/);
  });

  it("back and continue are there", () => {
    const h = html(s);
    assert.match(h, /data-action="bulk-back"/);
    assert.match(h, /data-action="bulk-next"/);
  });
});

describe("step 3: place", () => {
  const base = advance(matched("aloe vera\nmonstera"));

  it("shows three placement chips per plant, indoors pressed by default", () => {
    const h = html(base);
    const chips = h.match(/data-action="bulk-placement"/g) ?? [];
    assert.equal(chips.length, 6);
    assert.match(h, /data-value="indoor"[^>]+aria-pressed="true"/);
    assert.match(h, /data-value="ground"[^>]+aria-pressed="false"/);
  });

  it("'same as above' is offered from the second plant on", () => {
    const h = html(base);
    assert.equal((h.match(/data-action="bulk-same"/g) ?? []).length, 1);
  });

  it("a room chip row with the rooms and 'decide later' pressed by default", () => {
    const h = html(base);
    assert.match(h, /data-action="bulk-room"[^>]+data-value="r1"/);
    assert.match(h, /data-action="bulk-room"[^>]+data-value="r2"/);
    assert.match(h, /data-value=""[^>]+aria-pressed="true"/);
  });

  it("reflects the chips already set", () => {
    const id = base.rows[0]?.id ?? "";
    const h = html(setRowRoom(setRowPlacement(base, id, "ground"), id, "r2"));
    assert.match(h, /data-row="r1"[^>]+data-value="ground"[^>]+aria-pressed="true"/);
    assert.match(h, /data-row="r1"[^>]+data-value="r2"[^>]+aria-pressed="true"/);
  });
});

describe("step 4: verify", () => {
  const base = advance(advance(matched("aloe vera\npothos")));

  it("shows a collapsed row with a tick per plant; unresolved ones are unticked and say why", () => {
    const h = html(base);
    assert.match(h, /type="checkbox"[^>]+data-action="bulk-tick"[^>]+checked/);
    assert.match(h, /No match yet/);
    assert.equal((h.match(/<details/g) ?? []).length, 2);
  });

  it("greys assumed values with a mark and the word", () => {
    const h = html(base);
    assert.match(h, /class="assumed"/);
    assert.match(h, /assumed/);
    assert.match(h, /Water around every \d+ days/);
    assert.match(h, /15 cm/);
  });

  it("explains the wider window", () => {
    assert.match(html(base), /3 days wider/);
  });

  it("offers 'I watered all of these today' and 'Not sure', not sure pressed", () => {
    const h = html(base);
    assert.match(h, /data-action="bulk-watered"[^>]+data-value="today"[^>]+aria-pressed="false"/);
    assert.match(h, /data-action="bulk-watered"[^>]+data-value="unsure"[^>]+aria-pressed="true"/);
    assert.match(h, /check the soil today/i);
    assert.match(html(setWatered(base, "today")), /data-value="today"[^>]+aria-pressed="true"/);
  });

  it("the save button counts the ticked plants, counts included", () => {
    assert.match(html(base), /Save 1 plant/);
    const three = advance(advance(matched("3x aloe vera")));
    assert.match(html(three), /Save 3 plants/);
    assert.match(
      html(toggleRow(three, three.rows[0]?.id ?? "")),
      /data-action="bulk-save"[^>]*disabled/,
    );
  });

  it("says how many rows stay in 'Not added yet'", () => {
    assert.match(html(base), /1 row stays in .Not added yet./);
  });

  it("a ground plant has no pot line", () => {
    const s = advance(advance(setRowPlacement(matched("aloe vera"), "r1", "ground")));
    assert.doesNotMatch(html(s), /15 cm/);
  });

  it("the typed text is not in the step (it stays in state for Back)", () => {
    assert.doesNotMatch(html(setText(base, "zzz")), /<textarea/);
  });
});

describe("Not added yet list", () => {
  it("lists the bulk leftovers with resume and delete, empty when there are none", () => {
    assert.equal(notAddedHtml([]), "");
    const h = notAddedHtml([
      { id: "d1", savedOn: "2026-10-30", fields: { plantName: "xyzzy", notAdded: "1" } },
    ]);
    assert.match(h, /Not added yet/);
    assert.match(h, /xyzzy/);
    assert.match(h, /data-action="resume-draft"[^>]+data-id="d1"/);
    assert.match(h, /data-action="delete-draft"/);
  });
});
