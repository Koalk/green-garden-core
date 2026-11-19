// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPACE_ID,
  emptyData,
  exportData,
  fieldSource,
  importData,
  type AppData,
  type Plant,
} from "@green-garden/storage";
import {
  advance,
  answerQuestion,
  detailRows,
  groupFilledFrom,
  improveRows,
  makeMatcher,
  runMatch,
  saveBulk,
  startBulk,
  theyDiffer,
  waitingPlants,
  type BulkState,
} from "../src/index.ts";
import { SPECIES } from "./species.ts";

const TODAY = "2026-11-03";
const matcher = makeMatcher(SPECIES, "en-GB");
const verified = (text: string): BulkState => advance(advance(runMatch(startBulk(text), matcher)));

/** "3x aloe vera" saved through bulk add, plus a lone monstera. */
function saved(text = "3x aloe vera\nmonstera"): AppData {
  return saveBulk(emptyData(), verified(text), TODAY, SPECIES).data;
}
const byName = (d: AppData, name: string): Plant => {
  const p = d.plants.find((x) => x.name === name);
  assert.ok(p, name);
  return p;
};
const ids = (d: AppData): string[] => d.plants.map((p) => p.id);
const plantOf = (d: AppData, id: string): Plant => {
  const p = d.plants.find((x) => x.id === id);
  assert.ok(p, id);
  return p;
};
const pot = (d: AppData, id: string) => plantOf(d, id).potDiameterCm;
const three = (d: AppData): [string, string, string] => {
  const [a, b, c] = ids(d);
  assert.ok(a && b && c);
  return [a, b, c];
};

describe("bulk add records the group", () => {
  it("gives plants from one counted line the same batch id; singles have none", () => {
    const d = saved();
    const aloes = d.plants.filter((p) => p.name.startsWith("Aloe vera"));
    assert.equal(aloes.length, 3);
    assert.equal(new Set(aloes.map((p) => p.batch?.id)).size, 1);
    assert.ok(aloes[0]?.batch?.id);
    assert.equal(byName(d, "Swiss cheese plant").batch, undefined);
  });

  it("two counted lines are two groups", () => {
    const d = saved("2x aloe vera\n2x monstera");
    assert.equal(new Set(d.plants.map((p) => p.batch?.id)).size, 2);
  });

  it("a later bulk add never reuses a group id", () => {
    const first = saved("2x aloe vera");
    const second = saveBulk(first, verified("2x aloe vera"), TODAY, SPECIES).data;
    assert.equal(new Set(second.plants.map((p) => p.batch?.id)).size, 2);
  });
});

describe("answering for one fills the others", () => {
  it("fills the same field on the other members, with source user", () => {
    const d = saved();
    const [a, b, c] = three(d);
    const out = answerQuestion(d, a, "Q-POT", "large", TODAY);
    for (const id of [a, b, c]) {
      assert.equal(pot(out, id), 28);
      assert.equal(fieldSource(plantOf(out, id), "potDiameterCm"), "user");
    }
  });

  it("leaves plants that are not in the group alone", () => {
    const d = saved();
    const out = answerQuestion(d, ids(d)[0] ?? "", "Q-POT", "large", TODAY);
    assert.equal(byName(out, "Swiss cheese plant").potDiameterCm, 15);
    assert.equal(fieldSource(byName(out, "Swiss cheese plant"), "potDiameterCm"), "default");
  });

  it("never overwrites a value the member's owner gave", () => {
    let d = saved();
    const [a, b, c] = three(d);
    d = answerQuestion(d, b, "Q-POT", "small", TODAY); // fills a and c too
    d = answerQuestion(d, a, "Q-POT", "large", TODAY); // b is the user's own, c was only filled
    assert.equal(pot(d, b), 10);
    assert.equal(pot(d, a), 28);
    assert.equal(pot(d, c), 28);
  });

  it("a member that answers for itself keeps its own value from then on", () => {
    let d = saved();
    const [a, b, c] = three(d);
    d = answerQuestion(d, a, "Q-POT", "large", TODAY);
    d = answerQuestion(d, b, "Q-POT", "small", TODAY);
    d = answerQuestion(d, a, "Q-POT", "medium", TODAY);
    assert.equal(pot(d, b), 10);
    assert.equal(pot(d, a), 18);
    assert.equal(pot(d, c), 18);
  });

  it("fills a room, a value with no source of its own, only where it is empty", () => {
    let d = saved();
    d = { ...d, rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }] };
    const [a, b] = three(d);
    d = answerQuestion(d, a, "Q-ROOM", "r1", TODAY);
    assert.equal(plantOf(d, b).roomId, "r1");
  });

  it("'not sure' snoozes the asked plant only and fills nothing", () => {
    const d = saved();
    const [a, b] = three(d);
    const out = answerQuestion(d, a, "Q-MAT", "not_sure", TODAY);
    assert.ok(out.questionState?.[a]);
    assert.equal(out.questionState[b], undefined);
  });

  it("reports who was filled", () => {
    const d = saved();
    const [a, b, c] = three(d);
    const out = answerQuestion(d, a, "Q-POT", "large", TODAY);
    assert.deepEqual(groupFilledFrom(out, a, "Q-POT").sort(), [b, c].sort());
    assert.deepEqual(groupFilledFrom(out, b, "Q-POT"), []);
  });
});

describe("'They differ'", () => {
  it("puts the others back to what they had and marks the field split", () => {
    const d = saved();
    const [a, b, c] = three(d);
    const out = theyDiffer(answerQuestion(d, a, "Q-POT", "large", TODAY), a, "Q-POT");
    for (const id of [b, c]) {
      const p = plantOf(out, id);
      assert.equal(p.potDiameterCm, 15);
      assert.equal(fieldSource(p, "potDiameterCm"), "default");
      assert.ok(p.batch?.split?.includes("Q-POT"));
      assert.equal(p.batch?.filled?.["Q-POT"], undefined);
    }
    const mine = plantOf(out, a);
    assert.equal(mine.potDiameterCm, 28);
    assert.equal(fieldSource(mine, "potDiameterCm"), "user");
    assert.ok(mine.batch?.split?.includes("Q-POT"));
  });

  it("after the split an answer fills nobody", () => {
    const d = saved();
    const [a, b, c] = three(d);
    let out = theyDiffer(answerQuestion(d, a, "Q-POT", "large", TODAY), a, "Q-POT");
    out = answerQuestion(out, b, "Q-POT", "small", TODAY);
    assert.deepEqual([pot(out, a), pot(out, b), pot(out, c)], [28, 10, 15]);
  });

  it("other questions of the group still share after one is split", () => {
    const d = saved();
    const [a, b] = three(d);
    let out = theyDiffer(answerQuestion(d, a, "Q-POT", "large", TODAY), a, "Q-POT");
    out = answerQuestion(out, a, "Q-MAT", "terracotta", TODAY);
    assert.equal(plantOf(out, b).potMaterial, "terracotta");
  });

  it("a member that answered for itself is not reverted", () => {
    let d = saved();
    const [a, b, c] = three(d);
    d = answerQuestion(d, a, "Q-POT", "large", TODAY);
    d = answerQuestion(d, b, "Q-POT", "small", TODAY);
    d = theyDiffer(d, a, "Q-POT"); // c now holds b's answer, not a's, so it stays
    assert.equal(pot(d, b), 10);
    assert.equal(pot(d, c), 10);
    assert.equal(pot(d, a), 28);
  });

  it("does nothing for a plant with no group", () => {
    const d = saved();
    assert.deepEqual(theyDiffer(d, byName(d, "Swiss cheese plant").id, "Q-POT"), d);
    assert.deepEqual(theyDiffer(d, "nope", "Q-POT"), d);
  });
});

describe("a group's shared question counts once", () => {
  const things = (d: AppData) => improveRows(d, TODAY).reduce((n, r) => n + r.questions.length, 0);

  it("the Improve list counts a shared question once, not per plant", () => {
    const grouped = saved("3x aloe vera");
    const apart = saved("aloe vera\naloe vera\naloe vera");
    const one = things(saved("aloe vera"));
    assert.equal(things(grouped), one);
    assert.equal(things(apart), one * 3);
  });

  it("says how many others a question would fill", () => {
    const row = improveRows(saved("3x aloe vera"), TODAY)[0];
    assert.ok(row);
    const q = row.questions[0];
    assert.ok(q);
    assert.equal(row.alsoFor[q.id], 2);
  });

  it("a split question counts per plant again", () => {
    const d = saved("2x aloe vera");
    const [a] = ids(d);
    assert.ok(a);
    const out = theyDiffer(answerQuestion(d, a, "Q-POT", "large", TODAY), a, "Q-POT");
    // Q-POT is answered on the first plant and open, separately, on the second.
    assert.equal(things(out), things(d));
  });

  it("after the answer the whole group has nothing left for that question", () => {
    const d = saved("3x aloe vera");
    const out = answerQuestion(d, ids(d)[0] ?? "", "Q-POT", "large", TODAY);
    const open = improveRows(out, TODAY).flatMap((r) => r.questions.map((q) => q.id));
    assert.ok(!open.includes("Q-POT"));
  });

  it("the '!' shows on one member of a group, not on all", () => {
    assert.equal(waitingPlants(saved("aloe vera"), TODAY).length, 1);
    assert.equal(waitingPlants(saved("3x aloe vera"), TODAY).length, 1);
  });
});

describe("detail rows and export", () => {
  it("the answered plant's row says how many others share the answer", () => {
    const d = saved("3x aloe vera");
    const [a, b] = three(d);
    const out = answerQuestion(d, a, "Q-POT", "large", TODAY);
    assert.equal(detailRows(out, a).find((r) => r.question.id === "Q-POT")?.sharedWith, 2);
    assert.equal(detailRows(out, b).find((r) => r.question.id === "Q-POT")?.sharedWith, 0);
  });

  it("the group, the fills and the splits survive an export round trip", () => {
    const d = saved("3x aloe vera");
    const a = ids(d)[0] ?? "";
    const filled = answerQuestion(d, a, "Q-POT", "large", TODAY);
    const split = theyDiffer(filled, a, "Q-POT");
    for (const x of [d, filled, split]) {
      assert.deepEqual(importData(exportData(x)).data.plants, x.plants);
    }
  });
});

describe("batch undo of Q-SUNHOURS", () => {
  it("keeps directSun through export and import, then reverts it", () => {
    let d = saved("3x aloe vera");
    const [a, b] = d.plants;
    assert.ok(a && b);
    d = {
      ...d,
      plants: d.plants.map((x) =>
        x.id === b.id
          ? { ...x, fieldSources: { ...x.fieldSources, directSun: "default" as const } }
          : x,
      ),
    };
    d = answerQuestion(d, a.id, "Q-SUNHOURS", "morning", TODAY);
    const filled = d.plants.find((x) => x.id === b.id);
    assert.deepEqual(filled?.directSun, [{ from: 6, to: 11 }]);
    const back = importData(exportData(d)).data;
    assert.ok(back);
    const reverted = theyDiffer(back, a.id, "Q-SUNHOURS");
    assert.equal(reverted.plants.find((x) => x.id === b.id)?.directSun, undefined);
  });

  it("restores a previous list held before the fill", () => {
    let d = saved("2x aloe vera");
    const [a, b] = d.plants;
    assert.ok(a && b);
    d = {
      ...d,
      plants: d.plants.map((x) =>
        x.id === b.id
          ? {
              ...x,
              directSun: [{ from: 15, to: 19 }],
              fieldSources: { ...x.fieldSources, directSun: "default" as const },
            }
          : x,
      ),
    };
    d = answerQuestion(d, a.id, "Q-SUNHOURS", "morning", TODAY);
    const back = importData(exportData(d)).data;
    assert.ok(back);
    const reverted = theyDiffer(back, a.id, "Q-SUNHOURS");
    assert.deepEqual(reverted.plants.find((x) => x.id === b.id)?.directSun, [{ from: 15, to: 19 }]);
  });
});
