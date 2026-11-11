// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { setLocale, t } from "@green-garden/i18n";
import { QUESTIONS } from "@green-garden/questions";
import { DEFAULT_SPACE_ID, type AppData, type Plant } from "@green-garden/storage";
import { answerQuestion, nextForSitting, questionFor } from "../src/improve.ts";
import { tabFromHash } from "../src/tabs.ts";
import { askEndHtml, askHtml, bangHtml, detailHtml, improveHtml } from "../src/improve-view.ts";

const TODAY = "2026-11-03";

const plant = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id,
  spaceId: DEFAULT_SPACE_ID,
  name: `Pothos ${id}`,
  style: "let_top_dry",
  intervalDays: 7,
  logs: [{ date: "2026-11-01", outcome: "done" }],
  potDiameterCm: 15,
  fieldSources: { drainage: "default", light: "default", potDiameterCm: "default" },
  ...extra,
});

const data: AppData = {
  spaces: [{ id: DEFAULT_SPACE_ID, name: "Home", awayDates: [] }],
  plants: [plant("a"), plant("b")],
  rooms: [{ id: "r1", name: "Kitchen", spaceId: DEFAULT_SPACE_ID }],
  settings: { hemisphere: "north", horizonDays: 28, prefs: { preLeaveWatering: true } },
};

afterEach(() => {
  setLocale("en-GB");
});

describe("the '!' and one question at a time", () => {
  it("the '!' is a button named for the plant, so a screen reader hears what it is", () => {
    const html = bangHtml("a", "Pothos a");
    assert.match(html, /data-action="ask"/);
    assert.match(html, /aria-label="Pothos a has a question waiting"/);
    assert.match(bangHtml("room:r1", "Kitchen"), /The room Kitchen has a question waiting/);
  });

  it("shows the question, every option, a skip, ask me later and the never-asks", () => {
    const ask = nextForSitting(data, TODAY, 0);
    assert.ok(ask);
    const html = askHtml(data, ask, 2);
    assert.match(html, /A question about Pothos/);
    for (const o of ask.question.options) assert.match(html, new RegExp(`data-value="${o}"`));
    for (const word of ["Skip", "Ask me later", "Never ask this", "Never ask about this plant"]) {
      assert.match(html, new RegExp(word));
    }
    assert.match(html, /2 waiting/);
  });

  it("the room question has no 'never ask about this plant'", () => {
    const html = askHtml(data, { target: "room:r1", question: questionOf("Q-ROOMLIGHT") }, 1);
    assert.match(html, /A question about the room Kitchen/);
    assert.doesNotMatch(html, /ask-never-plant/);
  });

  it("the room question offers the space's rooms, plus 'no room'", () => {
    const html = askHtml(data, { target: "a", question: questionOf("Q-ROOM") }, 1);
    assert.match(html, /data-value="r1">Kitchen</);
    assert.match(html, /data-value="none"/);
  });

  it("ends with 'plenty' after five, or 'no more' when nothing is left", () => {
    assert.match(askEndHtml(true), /That’s plenty for now/);
    assert.match(askEndHtml(false), /No more questions right now/);
  });

  it("is worded in Spanish and Italian", () => {
    const ask = nextForSitting(data, TODAY, 0);
    assert.ok(ask);
    setLocale("es");
    assert.match(askHtml(data, ask, 1), /Una pregunta sobre/);
    assert.match(askHtml(data, ask, 1), /Pregúntame más tarde/);
    setLocale("it");
    assert.match(askHtml(data, ask, 1), /Una domanda su/);
    assert.match(askHtml(data, ask, 1), /Chiedimelo più tardi/);
  });

  it("answering, skipping and snoozing: the plant's '!' goes, the run moves on", () => {
    const first = nextForSitting(data, TODAY, 0);
    assert.ok(first);
    const answered = answerQuestion(
      data,
      first.target,
      first.question.id,
      first.question.options[0] ?? "",
      TODAY,
      {
        voluntary: true,
      },
    );
    const next = nextForSitting(answered, TODAY, 1);
    assert.ok(next);
    assert.notEqual(next.target, first.target);
    // skipping hides the plant for the rest of the run only
    const skipped = nextForSitting(data, TODAY, 0, [first.target]);
    assert.notEqual(skipped?.target, first.target);
  });
});

describe("improve care info", () => {
  it("is a list with the summary, inline buttons, a skip and fill-all per plant", () => {
    const html = improveHtml(data, TODAY, new Set());
    assert.match(html, /<h2>Improve care info<\/h2>/);
    assert.match(html, /2 plants, \d+ things to improve/);
    assert.match(html, /data-action="answer" data-mode="list"/);
    assert.match(html, /data-action="improve-skip"/);
    assert.match(html, /data-action="fill-all" data-id="a"/);
    assert.match(html, /could improve its care/);
  });

  it("a skipped question disappears from the view", () => {
    const first = improveHtml(data, TODAY, new Set());
    const q = questionFor(data, "a", TODAY);
    assert.ok(q);
    const html = improveHtml(data, TODAY, new Set([`a|${q.id}`]));
    assert.ok(html.length < first.length);
  });

  it("says so when there is nothing left", () => {
    const empty: AppData = { ...data, plants: [] };
    assert.match(improveHtml(empty, TODAY, new Set()), /Nothing to improve right now/);
  });

  it("carries the switch for 'Don't ask me questions'", () => {
    assert.match(improveHtml(data, TODAY, new Set()), /data-questions-setting>/);
    const off = { ...data, settings: { ...data.settings, questions: "off" as const } };
    assert.match(improveHtml(off, TODAY, new Set()), /data-questions-setting checked>/);
  });
});

describe("plant detail", () => {
  it("every row has its value, a source chip and a select to change it", () => {
    const p = plant("a", {
      drainage: "hole",
      fieldSources: { drainage: "user", light: "default" },
    });
    const html = detailHtml({ ...data, plants: [p, plant("b")] }, "a");
    assert.match(html, /What we know/);
    assert.match(html, /<dt>Drainage<\/dt><dd>Yes <small class="chip chip-you">you</);
    assert.match(html, /chip-assumed">~ assumed</);
    assert.match(html, /data-detail-q="Q-MAT" data-target="a"/);
    assert.match(html, /15 cm/);
  });

  it("shows 'not set' for what nobody told us", () => {
    assert.match(detailHtml(data, "a"), /not set/);
  });
});

describe("wording and wiring", () => {
  it("has a detail label for every question and the same keys in all three languages", () => {
    for (const tag of ["en-GB", "es", "it"]) {
      setLocale(tag);
      for (const q of QUESTIONS.filter((x) => !["Q-SPECIES", "Q-ROOMLIGHT"].includes(x.id))) {
        const key = `detail.row.${q.id}`;
        assert.notEqual(t(key), key, `${tag} ${key}`);
      }
      assert.notEqual(t("improve.heading"), "improve.heading");
    }
  });

  const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
  it("the Plants tab links to the list, shows the '!' and offers the question panel", () => {
    assert.match(src, /href="#improve"/);
    assert.match(src, /bangHtml\(p\.id, p\.name\)/);
    assert.match(src, /askPanel\(\)/);
    assert.match(src, /detailHtml\(data, p\.id\)/);
  });

  it("#improve is a view of the Plants tab and the old anchors still work", () => {
    assert.equal(tabFromHash("#improve"), "plants");
    assert.match(src, /tabFromHash\(window\.location\.hash\)/);
  });

  it("answers from the list do not use up the plant's question for the day", () => {
    assert.match(src, /voluntary: run/);
    assert.match(src, /run = mode === "run"/);
  });
});

function questionOf(id: string) {
  const q = QUESTIONS.find((x) => x.id === id);
  assert.ok(q);
  return q;
}
