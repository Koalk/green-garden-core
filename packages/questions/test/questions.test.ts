// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULTS_TABLE,
  QUESTIONS,
  askLater,
  neverAsk,
  neverAskPlant,
  nextQuestion,
  rankQuestions,
  type QuestionPlant,
  type QuestionState,
} from "../src/index.ts";

const TODAY = "2026-06-10";
const LOCALES = ["en-GB", "es", "it"] as const;

/** A plant added long ago, watered twice, with nothing else known: every ready question applies. */
function plant(id: string, extra: Partial<QuestionPlant> = {}): QuestionPlant {
  return { id, addedOn: "2026-01-01", waterings: 2, ...extra };
}

const ids = (qs: readonly { id: string }[]) => qs.map((q) => q.id);

describe("question bank", () => {
  it("holds the 4.3 bank and Q-LIVES, with unique ids", () => {
    const all = ids(QUESTIONS);
    assert.equal(new Set(all).size, all.length);
    for (const id of [
      "Q-DRAIN",
      "Q-FIRST",
      "Q-MAT",
      "Q-LIGHT",
      "Q-POT",
      "Q-SIZE",
      "Q-STILLWET",
      "Q-REPOT",
      "Q-ROOM",
      "Q-ROOMLIGHT",
      "Q-SPECIES",
      "Q-GROUND",
      "Q-DRAUGHT",
      "Q-LIVES",
    ])
      assert.ok(all.includes(id), id);
  });

  it("has plain wording in en-GB, es and it for every question and option", () => {
    for (const q of QUESTIONS) {
      for (const loc of LOCALES) {
        const t = q.text[loc];
        assert.ok(t.question.length > 0, `${q.id} ${loc} question`);
        for (const o of q.options)
          assert.ok((t.options[o] ?? "").length > 0, `${q.id} ${loc} ${o}`);
      }
      assert.match(q.storiesKey, /^stories\./);
    }
  });

  it("asks the draught question as written, yes / no / not sure, lowest priority", () => {
    const q = QUESTIONS.find((x) => x.id === "Q-DRAUGHT");
    assert.ok(q);
    assert.equal(
      q.text["en-GB"].question,
      "Is it near a radiator, air vent or an often-open window?",
    );
    assert.deepEqual(q.options, ["yes", "no", "not_sure"]);
    assert.equal(q.tier, "C");
    assert.equal(q.engineInput, false);
    const rank = rankQuestions(plant("d1", { placement: "indoor" }), TODAY, {}, { mode: "list" });
    assert.equal(ids(rank).at(-1), "Q-DRAUGHT");
  });

  it("links the defaults table to the bank and to the margin fields", () => {
    for (const row of DEFAULTS_TABLE) {
      if (row.questionId)
        assert.ok(
          QUESTIONS.some((q) => q.id === row.questionId),
          row.field,
        );
    }
    const margin = DEFAULTS_TABLE.filter((r) => r.countsForMargin)
      .map((r) => r.field)
      .sort();
    assert.deepEqual(margin, ["drainage", "lastWatered", "light", "potDiameterCm", "potMaterial"]);
    const ranks = DEFAULTS_TABLE.map((r) => r.rank);
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
    );
  });
});

describe("ordering", () => {
  it("is deterministic for one plant", () => {
    const a = ids(rankQuestions(plant("p1"), TODAY, {}, { mode: "list" }));
    const b = ids(rankQuestions({ ...plant("p1") }, TODAY, {}, { mode: "list" }));
    assert.deepEqual(a, b);
  });

  it("varies between plants inside a tier", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      orders.add(ids(rankQuestions(plant(`plant-${i}`), TODAY, {}, { mode: "list" })).join());
    }
    assert.ok(orders.size > 5, `only ${orders.size} distinct orders`);
  });

  it("never lets a lower tier beat a higher one, whatever the seed", () => {
    for (let i = 0; i < 200; i++) {
      const tiers = rankQuestions(plant(`t${i}`), TODAY, {}, { mode: "list" }).map((q) => q.tier);
      assert.deepEqual(tiers, [...tiers].sort(), `plant t${i}`);
    }
  });

  it("puts a relevant-now question ahead of a generic one in the same tier", () => {
    // One still-wet log makes Q-STILLWET and Q-LIGHT "now"; Q-POT is only ready, Q-SIZE only listed.
    for (let i = 0; i < 50; i++) {
      const order = ids(
        rankQuestions(plant(`n${i}`, { stillWet: 1 }), TODAY, {}, { mode: "list" }),
      );
      assert.ok(order.indexOf("Q-LIGHT") < order.indexOf("Q-POT"), `plant n${i}`);
      assert.ok(order.indexOf("Q-STILLWET") < order.indexOf("Q-REPOT"), `plant n${i}`);
    }
  });

  it("shuffles heavier questions earlier on average", () => {
    let sumHeavy = 0;
    let sumLight = 0;
    for (let i = 0; i < 300; i++) {
      const order = ids(rankQuestions(plant(`w${i}`), TODAY, {}, { mode: "list" }));
      sumHeavy += order.indexOf("Q-LIGHT");
      sumLight += order.indexOf("Q-ROOM");
    }
    assert.ok(sumHeavy < sumLight);
  });
});

describe("relevance", () => {
  it("asks about the pot material only once the plant has been watered", () => {
    const fresh = plant("m1", { waterings: 0 });
    assert.ok(!ids(rankQuestions(fresh, TODAY, {}, { mode: "voluntary" })).includes("Q-MAT"));
    assert.ok(ids(rankQuestions(fresh, TODAY, {}, { mode: "list" })).includes("Q-MAT"));
    assert.ok(ids(rankQuestions(plant("m2"), TODAY, {}, { mode: "voluntary" })).includes("Q-MAT"));
  });

  it("drops a question once the user has answered the field, keeps it while assumed", () => {
    const answered = plant("a1", {
      potMaterial: "terracotta",
      fieldSources: { potMaterial: "user" },
    });
    const assumed = plant("a2", {
      potMaterial: "plastic",
      fieldSources: { potMaterial: "default" },
    });
    assert.ok(!ids(rankQuestions(answered, TODAY, {}, { mode: "list" })).includes("Q-MAT"));
    assert.ok(ids(rankQuestions(assumed, TODAY, {}, { mode: "list" })).includes("Q-MAT"));
  });

  it("skips pot questions for plants in the ground and asks about sun and soil", () => {
    const order = ids(
      rankQuestions(plant("g1", { placement: "ground" }), TODAY, {}, { mode: "list" }),
    );
    for (const id of ["Q-POT", "Q-MAT", "Q-DRAIN", "Q-REPOT"]) assert.ok(!order.includes(id), id);
    assert.ok(order.includes("Q-GROUND"));
  });

  it("asks Q-REPOT in spring only, per hemisphere", () => {
    const p = plant("r1");
    const push = (today: string, hemisphere: "north" | "south") =>
      ids(rankQuestions(p, today, {}, { mode: "voluntary", hemisphere }));
    assert.ok(push("2026-04-10", "north").includes("Q-REPOT"));
    assert.ok(!push("2026-04-10", "south").includes("Q-REPOT"));
    assert.ok(push("2026-10-10", "south").includes("Q-REPOT"));
  });

  it("asks Q-SPECIES and Q-LIVES only when there is something to confirm", () => {
    const calm = ids(
      rankQuestions(plant("s1", { placement: "indoor" }), TODAY, {}, { mode: "voluntary" }),
    );
    assert.ok(!calm.includes("Q-SPECIES") && !calm.includes("Q-LIVES"));
    const odd = plant("s2", {
      placement: "indoor",
      typicalPlacement: "ground",
      speciesToConfirm: true,
    });
    const order = ids(rankQuestions(odd, TODAY, {}, { mode: "voluntary" }));
    assert.ok(order.includes("Q-SPECIES") && order.includes("Q-LIVES"));
  });
});

describe("pacing", () => {
  const p = plant("busy");

  it("gives 0 questions on a busy day (4 or more plants due) and one otherwise", () => {
    assert.equal(nextQuestion(p, TODAY, {}, { dueToday: 4 }), null);
    assert.equal(nextQuestion(p, TODAY, {}, { dueToday: 7 }), null);
    assert.ok(nextQuestion(p, TODAY, {}, { dueToday: 3 }));
  });

  it("pushes at most 2 questions a day in total, and 1 per plant", () => {
    assert.ok(nextQuestion(p, TODAY, {}, { pushedToday: 1 }));
    assert.equal(nextQuestion(p, TODAY, {}, { pushedToday: 2 }), null);
    assert.equal(nextQuestion(p, TODAY, { busy: { lastAskedOn: TODAY } }), null);
    assert.ok(nextQuestion(p, TODAY, { busy: { lastAskedOn: "2026-06-09" } }));
  });

  it("restricts a plant's first week to tier A and 1 question a day in total", () => {
    const fresh = plant("fresh", { addedOn: "2026-06-05", waterings: 0 });
    const q = nextQuestion(fresh, TODAY, {}, { pushedToday: 0 });
    assert.equal(q?.tier, "A");
    assert.equal(nextQuestion(fresh, TODAY, {}, { pushedToday: 1 }), null);
    const onlyB = plant("fresh2", {
      addedOn: "2026-06-05",
      drainage: "hole",
      fieldSources: { drainage: "user" },
      lastWatered: "2026-06-05",
    });
    assert.equal(nextQuestion(onlyB, TODAY, {}, {}), null);
    assert.ok(nextQuestion(onlyB, TODAY, {}, { mode: "voluntary" }));
  });

  it("is quiet when questions are switched off", () => {
    assert.equal(nextQuestion(p, TODAY, {}, { setting: "off" }), null);
    assert.equal(nextQuestion(p, TODAY, {}, { setting: "off", mode: "voluntary" }), null);
    assert.ok(rankQuestions(p, TODAY, {}, { setting: "off", mode: "list" }).length > 0);
  });

  it("caps a voluntary run at 5 answers a sitting and ignores the daily push cap", () => {
    assert.ok(
      nextQuestion(
        p,
        TODAY,
        {},
        {
          mode: "voluntary",
          answeredThisSitting: 4,
          pushedToday: 2,
          dueToday: 9,
        },
      ),
    );
    assert.equal(nextQuestion(p, TODAY, {}, { mode: "voluntary", answeredThisSitting: 5 }), null);
  });
});

describe("snooze and never ask", () => {
  const p = plant("snz");
  const first = () => {
    const q = nextQuestion(p, TODAY, {}, { mode: "voluntary" });
    assert.ok(q);
    return q;
  };

  it("holds a snoozed question back for 14 days", () => {
    const q = first();
    const state = askLater({}, "snz", q.id, TODAY);
    for (const day of ["2026-06-10", "2026-06-23"]) {
      assert.ok(!ids(rankQuestions(p, day, state, { mode: "voluntary" })).includes(q.id), day);
    }
    assert.ok(ids(rankQuestions(p, "2026-06-24", state, { mode: "voluntary" })).includes(q.id));
  });

  it("moves a question to the improve list only after the third snooze", () => {
    const q = first();
    let state: QuestionState = {};
    state = askLater(state, "snz", q.id, "2026-06-10");
    state = askLater(state, "snz", q.id, "2026-06-24");
    assert.ok(ids(rankQuestions(p, "2026-07-08", state, { mode: "voluntary" })).includes(q.id));
    state = askLater(state, "snz", q.id, "2026-07-08");
    assert.ok(!ids(rankQuestions(p, "2027-01-01", state, { mode: "voluntary" })).includes(q.id));
    assert.ok(ids(rankQuestions(p, "2027-01-01", state, { mode: "list" })).includes(q.id));
  });

  it("never asks again after never-ask, for that question or the whole plant", () => {
    const q = first();
    const one = neverAsk({}, "snz", q.id);
    assert.ok(!ids(rankQuestions(p, TODAY, one, { mode: "voluntary" })).includes(q.id));
    assert.ok(ids(rankQuestions(p, TODAY, one, { mode: "voluntary" })).length > 0);
    const all = neverAskPlant({}, "snz");
    assert.equal(nextQuestion(p, TODAY, all, { mode: "voluntary" }), null);
    assert.ok(ids(rankQuestions(p, TODAY, all, { mode: "list" })).includes(q.id));
  });

  it("does not mutate the state it is given", () => {
    const state: QuestionState = {};
    askLater(state, "snz", "Q-MAT", TODAY);
    assert.deepEqual(state, {});
  });
});
