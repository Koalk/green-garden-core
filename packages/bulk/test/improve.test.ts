// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPACE_ID, fieldSource, type AppData, type Plant } from "@green-garden/storage";
import {
  answerQuestion,
  detailRows,
  improveRows,
  nextForSitting,
  roomIsWaiting,
  setQuestionsSetting,
  snoozeQuestion,
  neverAskQuestion,
  neverAskAboutPlant,
  sourceChip,
  waitingPlants,
} from "../src/improve.ts";

const TODAY = "2026-11-03";

function plant(id: string, extra: Partial<Plant> = {}): Plant {
  return {
    id,
    spaceId: DEFAULT_SPACE_ID,
    name: `Plant ${id}`,
    style: "let_top_dry",
    intervalDays: 7,
    logs: [],
    ...extra,
  };
}

function dataOf(plants: Plant[], extra: Partial<AppData> = {}): AppData {
  return {
    spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
    plants,
    rooms: [],
    settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
    ...extra,
  };
}

/** A plant straight from bulk add: everything assumed, nothing watered yet. */
const assumedPlant = (id: string, extra: Partial<Plant> = {}): Plant =>
  plant(id, {
    potDiameterCm: 15,
    fieldSources: {
      drainage: "default",
      lastWatered: "default",
      light: "default",
      potDiameterCm: "default",
      potMaterial: "default",
    },
    ...extra,
  });

describe("improve list: ordering and content (01i section 6)", () => {
  it("lists every plant with something to improve, ignoring pacing and the busy day", () => {
    const d = dataOf([assumedPlant("a"), assumedPlant("b"), assumedPlant("c"), assumedPlant("d")]);
    const rows = improveRows(d, TODAY);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.questions.length >= 3));
  });

  it("a plant with nothing open is not listed", () => {
    const done = plant("a", {
      placement: "indoor",
      drainage: "hole",
      lastWatered: "2026-11-01",
      light: "medium",
      potDiameterCm: 15,
      potMaterial: "plastic",
      soilType: "standard",
      lastRepotted: "2026-01-01",
      plantSize: "medium",
      draught: "no",
    });
    assert.deepEqual(improveRows(dataOf([done]), TODAY), []);
  });

  it("each plant's questions are in tier order, and plants with more open things come first", () => {
    const few = plant("few", { drainage: "hole", lastWatered: "2026-11-01", light: "low" });
    const many = assumedPlant("many");
    const rows = improveRows(dataOf([few, many]), TODAY);
    assert.deepEqual(
      rows.map((r) => r.plant.id),
      ["many", "few"],
    );
    for (const r of rows) {
      const tiers = r.questions.map((q) => q.tier);
      assert.deepEqual(tiers, [...tiers].sort());
    }
  });

  it("the order is the same on every call (seeded, deterministic)", () => {
    const d = dataOf([assumedPlant("a"), assumedPlant("b")]);
    const ids = (x: ReturnType<typeof improveRows>) => x.map((r) => r.questions.map((q) => q.id));
    assert.deepEqual(ids(improveRows(d, TODAY)), ids(improveRows(d, TODAY)));
  });

  it("an 'unmatched' plant with no room has no room question when the space has no rooms", () => {
    const rows = improveRows(dataOf([assumedPlant("a")]), TODAY);
    assert.ok(!rows[0]?.questions.some((q) => q.id === "Q-ROOM"));
  });

  it("offers the room question once there is a room", () => {
    const d = dataOf([assumedPlant("a", { lastWatered: "2026-11-01" })], {
      rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
    });
    // watered once so the room question is ready
    const watered = {
      ...d,
      plants: [
        {
          ...assumedPlant("a"),
          logs: [{ date: "2026-10-30", outcome: "done" as const }],
        },
      ],
    };
    assert.ok(improveRows(watered, TODAY)[0]?.questions.some((q) => q.id === "Q-ROOM"));
  });

  it("with the questions switched off the list still works", () => {
    const d = setQuestionsSetting(dataOf([assumedPlant("a")]), "off");
    assert.equal(improveRows(d, TODAY).length, 1);
  });
});

describe("the '!' marker and the voluntary run (01i section 5.3)", () => {
  it("marks a plant that has a voluntary question waiting, never one with nothing ready", () => {
    const ready = assumedPlant("a", { logs: [{ date: "2026-11-01", outcome: "done" }] });
    const quiet = plant("b", {
      placement: "indoor",
      drainage: "hole",
      lastWatered: "2026-11-01",
      light: "medium",
      potDiameterCm: 15,
      potMaterial: "plastic",
      soilType: "standard",
      lastRepotted: "2026-01-01",
      plantSize: "medium",
      draught: "no",
    });
    assert.deepEqual(waitingPlants(dataOf([ready, quiet]), TODAY), ["a"]);
  });

  it("works with gamification off: nothing in core depends on it, and 'off' silences the marks", () => {
    const d = dataOf([assumedPlant("a")]);
    assert.deepEqual(waitingPlants(d, TODAY), ["a"]);
    assert.deepEqual(waitingPlants(setQuestionsSetting(d, "off"), TODAY), []);
  });

  it("a plant that was asked today shows no '!' until tomorrow (one a day per plant)", () => {
    const d = dataOf([assumedPlant("a")]);
    const answered = answerQuestion(d, "a", "Q-DRAIN", "hole", TODAY, { voluntary: true });
    assert.deepEqual(waitingPlants(answered, TODAY), []);
    assert.deepEqual(waitingPlants(answered, "2026-11-04"), ["a"]);
  });

  it("a room without light is marked once, for Q-ROOMLIGHT, and the plant is not", () => {
    const d = dataOf([assumedPlant("a", { roomId: "r1", light: "medium" })], {
      rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
    });
    assert.equal(roomIsWaiting(d, "r1", TODAY), true);
    const lit = {
      ...d,
      rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID, light: "medium" as const }],
    };
    assert.equal(roomIsWaiting(lit, "r1", TODAY), false);
  });

  it("a run stops after 5 answers", () => {
    const plants = Array.from({ length: 8 }, (_, i) => assumedPlant(`p${String(i)}`));
    const d = dataOf(plants);
    assert.ok(nextForSitting(d, TODAY, 4) !== undefined);
    assert.equal(nextForSitting(d, TODAY, 5), undefined);
  });

  it("a run offers each plant once a day and skips the ones the user skipped", () => {
    const d = dataOf([assumedPlant("a"), assumedPlant("b")]);
    const first = nextForSitting(d, TODAY, 0);
    assert.ok(first);
    const second = nextForSitting(d, TODAY, 0, [first.target]);
    assert.ok(second);
    assert.notEqual(second.target, first.target);
    assert.equal(nextForSitting(d, TODAY, 0, [first.target, second.target]), undefined);
  });

  it("stays quiet when the questions are switched off", () => {
    const d = setQuestionsSetting(dataOf([assumedPlant("a")]), "off");
    assert.equal(nextForSitting(d, TODAY, 0), undefined);
  });
});

describe("answering writes the field with source 'you' and the plan can use it at once", () => {
  it("drainage", () => {
    const d = dataOf([assumedPlant("a")]);
    const next = answerQuestion(d, "a", "Q-DRAIN", "no_hole", TODAY);
    const p = next.plants[0];
    assert.equal(p?.drainage, "no_hole");
    assert.equal(fieldSource(p, "drainage"), "user");
  });

  it("last watered: relative answers become dates", () => {
    const d = dataOf([assumedPlant("a")]);
    const at = (v: string) => answerQuestion(d, "a", "Q-FIRST", v, TODAY).plants[0]?.lastWatered;
    assert.equal(at("today"), "2026-11-03");
    assert.equal(at("this_week"), "2026-10-27");
    assert.equal(at("over_2_weeks"), "2026-10-19");
    assert.equal(at("no_idea"), undefined);
  });

  it("'no idea' is not forced: the question is never asked again, the value stays editable", () => {
    const d = dataOf([assumedPlant("a")]);
    const next = answerQuestion(d, "a", "Q-FIRST", "no_idea", TODAY);
    assert.equal(next.questionState?.["a"]?.never?.["Q-FIRST"], true);
    assert.equal(next.plants[0]?.fieldSources?.lastWatered, "default");
  });

  it("pot size classes become a rough diameter", () => {
    const d = dataOf([assumedPlant("a")]);
    const at = (v: string) => answerQuestion(d, "a", "Q-POT", v, TODAY).plants[0]?.potDiameterCm;
    assert.equal(at("small"), 10);
    assert.equal(at("medium"), 18);
    assert.equal(at("large"), 28);
  });

  it("material, light, soil, size, placement, draught", () => {
    const d = dataOf([assumedPlant("a")]);
    const p = (q: string, v: string) => answerQuestion(d, "a", q, v, TODAY).plants[0];
    assert.equal(p("Q-MAT", "terracotta")?.potMaterial, "terracotta");
    assert.equal(p("Q-LIGHT", "direct")?.light, "direct");
    assert.equal(p("Q-STILLWET", "peaty")?.soilType, "peaty");
    assert.equal(p("Q-SIZE", "large")?.plantSize, "large");
    assert.equal(p("Q-LIVES", "ground")?.placement, "ground");
    assert.equal(p("Q-DRAUGHT", "yes")?.draught, "yes");
    assert.equal(p("Q-SUNHOURS", "morning")?.directSun?.length, 1);
    assert.equal(p("Q-GROUND", "clay")?.groundSoil, "clay");
  });

  it("last repotted turns the answer into a date; 'never or no idea' is not asked again", () => {
    const d = dataOf([assumedPlant("a")]);
    const at = (v: string) => answerQuestion(d, "a", "Q-REPOT", v, TODAY);
    assert.equal(at("this_year").plants[0]?.lastRepotted, "2026-11-03");
    assert.equal(at("last_year").plants[0]?.lastRepotted, "2025-11-03");
    assert.equal(at("never_or_unknown").plants[0]?.lastRepotted, undefined);
    assert.equal(at("never_or_unknown").questionState?.["a"]?.never?.["Q-REPOT"], true);
  });

  it("a room answer assigns the plant, 'none' stops asking", () => {
    const d = dataOf([assumedPlant("a")], {
      rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
    });
    assert.equal(answerQuestion(d, "a", "Q-ROOM", "r1", TODAY).plants[0]?.roomId, "r1");
    assert.equal(
      answerQuestion(d, "a", "Q-ROOM", "none", TODAY).questionState?.["a"]?.never?.["Q-ROOM"],
      true,
    );
  });

  it("the room's light is set through the room target", () => {
    const d = dataOf([assumedPlant("a", { roomId: "r1" })], {
      rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
    });
    const next = answerQuestion(d, "room:r1", "Q-ROOMLIGHT", "bright_indirect", TODAY);
    assert.equal(next.rooms[0]?.light, "bright_indirect");
  });

  it("'not sure' waits 14 days; a third one leaves it in the list only", () => {
    let d = dataOf([assumedPlant("a", { logs: [{ date: "2026-11-01", outcome: "done" }] })]);
    d = answerQuestion(d, "a", "Q-MAT", "not_sure", TODAY);
    assert.equal(d.questionState?.["a"]?.snoozedUntil?.["Q-MAT"], "2026-11-17");
    assert.ok(!waitingPlants(d, TODAY).includes("never"));
    const inList = improveRows(d, TODAY)[0]?.questions.some((q) => q.id === "Q-MAT");
    assert.equal(inList, true);
  });

  it("answering clears the question: it is no longer listed", () => {
    const d = dataOf([assumedPlant("a")]);
    const before = improveRows(d, TODAY)[0]?.questions.map((q) => q.id) ?? [];
    assert.ok(before.includes("Q-DRAIN"));
    const after = improveRows(answerQuestion(d, "a", "Q-DRAIN", "hole", TODAY), TODAY)[0]
      ?.questions;
    assert.ok(!after?.some((q) => q.id === "Q-DRAIN"));
  });

  it("an unknown option changes nothing", () => {
    const d = dataOf([assumedPlant("a")]);
    assert.equal(answerQuestion(d, "a", "Q-DRAIN", "banana", TODAY), d);
    assert.equal(answerQuestion(d, "zzz", "Q-DRAIN", "hole", TODAY), d);
  });
});

describe("snooze and never ask (01i section 5.4)", () => {
  it("ask me later hides it from the '!' for 14 days but not from the list", () => {
    let d = dataOf([assumedPlant("a", { logs: [{ date: "2026-11-01", outcome: "done" }] })]);
    const first = nextForSitting(d, TODAY, 0);
    assert.ok(first);
    for (const q of improveRows(d, TODAY)[0]?.questions ?? [])
      d = snoozeQuestion(d, "a", q.id, TODAY);
    assert.deepEqual(waitingPlants(d, TODAY), []);
    assert.deepEqual(waitingPlants(d, "2026-11-18").length > 0, true);
    assert.ok((improveRows(d, TODAY)[0]?.questions.length ?? 0) > 0);
  });

  it("never ask this: gone from the '!' and the runs, still in the list", () => {
    let d = dataOf([assumedPlant("a")]);
    for (const q of improveRows(d, TODAY)[0]?.questions ?? []) d = neverAskQuestion(d, "a", q.id);
    assert.deepEqual(waitingPlants(d, TODAY), []);
    assert.ok((improveRows(d, TODAY)[0]?.questions.length ?? 0) > 0);
  });

  it("never ask about this plant silences the whole plant", () => {
    const d = neverAskAboutPlant(dataOf([assumedPlant("a")]), "a");
    assert.deepEqual(waitingPlants(d, TODAY), []);
    assert.equal(nextForSitting(d, TODAY, 0), undefined);
    assert.equal(improveRows(d, TODAY).length, 1);
  });
});

describe("plant detail: source chips and editable rows (01i section 6)", () => {
  it("chips: you, assumed, learned", () => {
    const p = assumedPlant("a", {
      drainage: "hole",
      fieldSources: { drainage: "user", light: "default", potDiameterCm: "learned" },
    });
    assert.equal(sourceChip(p, "drainage"), "you");
    assert.equal(sourceChip(p, "light"), "assumed");
    assert.equal(sourceChip(p, "potDiameterCm"), "learned");
    assert.equal(sourceChip(plant("b"), "light"), "you");
  });

  it("a row for every question field, each with its chip and options", () => {
    const rows = detailRows(dataOf([assumedPlant("a")]), "a");
    const ids = rows.map((r) => r.question.id);
    for (const id of ["Q-LIVES", "Q-DRAIN", "Q-FIRST", "Q-LIGHT", "Q-POT", "Q-MAT", "Q-STILLWET"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.ok(!ids.includes("Q-GROUND"), "the ground question only for a plant in the ground");
    const drain = rows.find((r) => r.question.id === "Q-DRAIN");
    assert.equal(drain?.chip, "assumed");
    assert.equal(drain.value, undefined);
  });

  it("editing from the detail sets the source to 'you' and works with the questions off", () => {
    const d = setQuestionsSetting(dataOf([assumedPlant("a")]), "off");
    const next = answerQuestion(d, "a", "Q-MAT", "fabric", TODAY);
    const row = detailRows(next, "a").find((r) => r.question.id === "Q-MAT");
    assert.equal(row?.chip, "you");
    assert.equal(row.value, "fabric");
  });

  it("ground plants get the ground row and lose the pot rows", () => {
    const rows = detailRows(dataOf([assumedPlant("a", { placement: "ground" })]), "a");
    const ids = rows.map((r) => r.question.id);
    assert.ok(ids.includes("Q-GROUND"));
    assert.ok(!ids.includes("Q-POT") && !ids.includes("Q-DRAIN") && !ids.includes("Q-MAT"));
  });
});

describe("sittings and the tapped '!'", () => {
  it("a sitting resets after 30 minutes", async () => {
    const { answersThisSitting } = await import("../src/improve.ts");
    assert.equal(answersThisSitting(3, 0, 29 * 60_000), 3);
    assert.equal(answersThisSitting(3, 0, 31 * 60_000), 0);
  });

  it("questionFor gives the plant's first waiting question, and none for a quiet one", async () => {
    const { questionFor } = await import("../src/improve.ts");
    const d = dataOf([assumedPlant("a"), plant("b", { drainage: "hole" })]);
    assert.equal(questionFor(d, "a", TODAY)?.tier, "A");
    assert.equal(questionFor(d, "nobody", TODAY), undefined);
  });
});

describe("in-ground and outdoor questions in the app flow (Q-K2, Q-K5, Q-K6)", () => {
  const ground = (extra: Partial<Plant> = {}) =>
    dataOf([assumedPlant("a", { placement: "ground", ...extra })]);
  const answer = (d: AppData, q: string, v: string) =>
    answerQuestion(d, "a", q, v, TODAY).plants[0];

  it("lists them for a plant in the ground, planting date and soil first in their tier", () => {
    const all = improveRows(ground(), TODAY)[0]?.questions.map((q) => q.id) ?? [];
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER", "Q-GROUND"]) assert.ok(all.includes(id));
    const tierB = all.filter((id) => ["Q-PLANTED", "Q-GROUND", "Q-MULCH", "Q-COVER"].includes(id));
    assert.deepEqual(tierB.slice(0, 2).sort(), ["Q-GROUND", "Q-PLANTED"]);
  });

  it("the planting date answer becomes a date and counts as the person's own", () => {
    const d = ground();
    assert.equal(answer(d, "Q-PLANTED", "this_year")?.plantedOn, "2026-09-04");
    assert.equal(answer(d, "Q-PLANTED", "last_year")?.plantedOn, "2025-11-03");
    assert.equal(answer(d, "Q-PLANTED", "longer")?.plantedOn, "2024-05-17");
    assert.equal(fieldSource(answer(d, "Q-PLANTED", "last_year") as Plant, "plantedOn"), "user");
    // "not sure" keeps the plant as it was
    assert.equal(answer(d, "Q-PLANTED", "not_sure")?.plantedOn, undefined);
  });

  it("mulch and cover set a yes or no", () => {
    const d = ground();
    assert.equal(answer(d, "Q-MULCH", "yes")?.mulched, true);
    assert.equal(answer(d, "Q-MULCH", "no")?.mulched, false);
    assert.equal(answer(d, "Q-COVER", "yes")?.sheltered, true);
    assert.equal(answer(d, "Q-COVER", "no")?.sheltered, false);
    assert.equal(answer(d, "Q-COVER", "not_sure")?.sheltered, undefined);
  });

  it("an answered question leaves the list", () => {
    const next = answerQuestion(ground(), "a", "Q-PLANTED", "last_year", TODAY);
    const ids = improveRows(next, TODAY)[0]?.questions.map((q) => q.id) ?? [];
    assert.ok(!ids.includes("Q-PLANTED"));
  });

  it("the plant detail shows a row for each, only where they apply", () => {
    const rows = detailRows(ground({ plantedOn: "2026-03-01", mulched: true }), "a");
    const byId = (id: string) => rows.find((r) => r.question.id === id);
    assert.equal(byId("Q-PLANTED")?.value, "2026-03-01");
    assert.equal(byId("Q-MULCH")?.value, "true");
    assert.ok(byId("Q-COVER"));
    const indoor = detailRows(dataOf([assumedPlant("a")]), "a").map((r) => r.question.id);
    for (const id of ["Q-PLANTED", "Q-MULCH", "Q-COVER"]) assert.ok(!indoor.includes(id), id);
    const pot = detailRows(dataOf([assumedPlant("a", { placement: "outdoor_pot" })]), "a");
    const potIds = pot.map((r) => r.question.id);
    assert.ok(potIds.includes("Q-COVER"));
    assert.ok(!potIds.includes("Q-PLANTED") && !potIds.includes("Q-MULCH"));
  });
});
