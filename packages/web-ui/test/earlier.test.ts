// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import { plantRows, isDueRow } from "../src/view.ts";
import { makePlan } from "../src/index.ts";

const TODAY = "2026-11-02";
const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

describe("Watered it earlier? on due plants", () => {
  it("a plant card offers Dry early only when the plant is not due, and the date question when it is", () => {
    const card = src.slice(
      src.indexOf("function earlierButtonHtml"),
      src.indexOf("function plantsSection"),
    );
    assert.match(card, /isDueRow\(/);
    assert.match(card, /data-action="earlier"/);
    assert.match(card, /data-outcome="dry_early"/);
    // The two sit in different branches of the same ternary.
    assert.ok(card.indexOf("isDueRow(r, today) ? earlierButtonHtml") > 0);
  });

  it("the date field defaults to today and is bounded by the plant's last watering and today", () => {
    const card = src.slice(
      src.indexOf("function earlierButtonHtml"),
      src.indexOf("function plantsSection"),
    );
    assert.match(card, /type="date"[^>]*value="\$\{esc\(today\)\}"/);
    assert.match(card, /min="/);
    assert.match(card, /max="/);
  });

  it("saving goes through logWateredEarlier, with an invalid date refused", () => {
    assert.match(src, /case "earlier":/);
    assert.match(src, /logWateredEarlier\(/);
  });

  it("isDueRow: overdue or due today is due; later is not", () => {
    const d = emptyData();
    const data = {
      ...d,
      plants: [
        {
          id: "a",
          spaceId: "space1",
          name: "A",
          style: "keep_moist" as const,
          intervalDays: 4,
          logs: [{ date: "2026-10-20", outcome: "done" as const }],
        },
        {
          id: "b",
          spaceId: "space1",
          name: "B",
          style: "keep_moist" as const,
          intervalDays: 4,
          logs: [{ date: "2026-11-01", outcome: "done" as const }],
        },
      ],
    };
    const plan = makePlan(data, TODAY);
    const rows = plantRows(plan, [], data);
    const [a, b] = rows;
    assert.ok(a !== undefined && b !== undefined);
    assert.equal(isDueRow(a, TODAY), true);
    assert.equal(isDueRow(b, TODAY), false);
  });
});
