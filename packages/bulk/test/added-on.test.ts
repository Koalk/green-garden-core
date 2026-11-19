// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plantFromFields } from "../src/drafts.ts";
import type { Plant } from "@green-garden/storage";

describe("plantFromFields addedOn", () => {
  it("saves a typed 'Had it since' date as a real one", () => {
    const p = plantFromFields({ plantName: "A", addedOn: "2026-03-01" }, undefined);
    assert.equal(p.addedOn, "2026-03-01");
    assert.equal(p.addedOnEstimated, undefined);
  });

  it("an unchanged estimated date stays estimated; an edited one becomes real", () => {
    const old = {
      id: "p1",
      spaceId: "s",
      name: "A",
      style: "let_top_dry",
      intervalDays: 7,
      logs: [],
      addedOn: "2026-03-01",
      addedOnEstimated: true,
    } as Plant;
    assert.equal(
      plantFromFields({ plantName: "A", addedOn: "2026-03-01" }, old).addedOnEstimated,
      true,
    );
    const edited = plantFromFields({ plantName: "A", addedOn: "2026-02-01" }, old);
    assert.equal(edited.addedOn, "2026-02-01");
    assert.equal(edited.addedOnEstimated, undefined);
  });

  it("clearing the field drops the date", () => {
    const old = {
      id: "p1",
      spaceId: "s",
      name: "A",
      style: "let_top_dry",
      intervalDays: 7,
      logs: [],
      addedOn: "2026-03-01",
    } as Plant;
    assert.equal(plantFromFields({ plantName: "A", addedOn: "" }, old).addedOn, undefined);
  });
});
