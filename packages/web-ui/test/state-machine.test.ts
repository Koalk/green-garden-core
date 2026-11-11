// SPDX-License-Identifier: AGPL-3.0-only

/**
 * state-machine tests: random click sequences against the actions and view models, asserting
 * what a user would notice. Seeded, so a failure prints the seed and step to replay.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatDate, parseDate, type LogOutcome } from "@green-garden/engine";
import { exportData, importData, type AppData } from "@green-garden/storage";
import {
  addAwayRange,
  cantWaterToday,
  ADJECTIVES,
  NOUNS,
  randomName,
  addPlant,
  calendarWeeks,
  dayEntries,
  deletePlant,
  fixtureData,
  logOutcome,
  makePlan,
  waterAll,
  removeAwayDate,
  setPrefs,
  updatePlant,
} from "../src/index.ts";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = "2026-07-06";
const OUTCOMES: readonly LogOutcome[] = ["done", "skipped", "still_wet", "dry_early"];

function ids(data: AppData, today: string): string[] {
  return dayEntries(makePlan(data, today), data, today).map((e) => e.plantId);
}

function addDays(date: string, n: number): string {
  return formatDate((parseDate(date) ?? 0) + n);
}

function loggedOn(data: AppData, id: string, date: string): boolean {
  return (data.plants.find((p) => p.id === id)?.logs ?? []).some((l) => l.date === date);
}

interface World {
  data: AppData;
  today: string;
}

/** Cross-checks that hold in every state. */
function checkState(w: World, where: string): void {
  const plan = makePlan(w.data, w.today);
  assert.deepEqual(plan.issues, [], `${where}: engine issues`);
  // The calendar and Today agree, and every plan day shows the same plants as the calendar.
  const weeks = calendarWeeks(plan, w.data, w.today, w.data.settings.horizonDays);
  const cells = weeks.flat().filter((c) => c.inPlan);
  assert.equal(cells.length, w.data.settings.horizonDays, `${where}: calendar cell count`);
  const todayCell = cells.find((c) => c.isToday);
  assert.ok(todayCell, `${where}: no today cell`);
  const names = dayEntries(plan, w.data, w.today).map((e) => e.name);
  assert.deepEqual([...todayCell.plantNames], names, `${where}: calendar vs Today`);
  for (const day of plan.days) {
    const cell = cells.find((c) => c.date === day.date);
    assert.ok(cell, `${where}: plan day ${day.date} missing from calendar`);
    assert.equal(cell.plantNames.length, day.plantIds.length, `${where}: ${day.date} count`);
  }
  // Nothing is planned on an away day.
  const away = new Set(w.data.spaces[0]?.awayDates ?? []);
  for (const day of plan.days) assert.ok(!away.has(day.date), `${where}: planned on away day`);
}

describe("UI state machine (seeded)", () => {
  it("random click sequences keep the invariants a user would notice", () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const r = rng(seed);
      const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
      const w: World = { today: addDays(START, int(0, 200)), data: fixtureData(START) };
      w.data = fixtureData(w.today);
      for (let step = 0; step < 40; step += 1) {
        const where = `seed ${seed} step ${step} today ${w.today}`;
        const before = ids(w.data, w.today);
        const roll = r();
        if (roll < 0.4 && before.length > 0) {
          const id = before[int(0, before.length - 1)] as string;
          const outcome = OUTCOMES[int(0, 3)] as LogOutcome;
          const next = logOutcome(w.data, id, outcome, w.today);
          const after = ids(next, w.today);
          // One click changes only the plant clicked: every other plant keeps its place on Today.
          for (const other of before.filter((x) => x !== id)) {
            const was = dayEntries(makePlan(w.data, w.today), w.data, w.today).find(
              (e) => e.plantId === other,
            );
            // optional pre-leave waterings are pinned, so a click on another
            // plant no longer moves them.
            // Rule 23: when the clicked plant was the only one setting today, plants that merely
            // joined it go back to their own days after a snooze or skip. The "why" said so.
            if (
              (outcome === "still_wet" || outcome === "skipped") &&
              was?.why.startsWith("Moved to water together")
            ) {
              continue;
            }
            assert.ok(
              after.includes(other),
              `${where}: ${other} left Today after ${outcome} ${id} (was: ${was?.why})`,
            );
          }
          // Rule 22 pins today once a plant is logged: plants whose window is open today may join
          // it (shown as "moved to water together"), but nothing else appears.
          const nowEntries = dayEntries(makePlan(next, w.today), next, w.today);
          for (const x of after.filter((i) => !before.includes(i))) {
            const e = nowEntries.find((y) => y.plantId === x);
            assert.ok(e?.moved, `${where}: ${x} appeared without an explanation`);
          }
          // The click is visible: done and still wet remove the plant; skip keeps it greyed out;
          // dry early keeps it due with a note.
          const entry = dayEntries(makePlan(next, w.today), next, w.today).find(
            (e) => e.plantId === id,
          );
          if (outcome === "done") {
            assert.ok(entry === undefined, `${where}: ${id} still on Today after done`);
          } else if (outcome === "still_wet" || outcome === "skipped") {
            // Both mean "not today": the plant leaves Today (or is greyed out if its window is over).
            assert.ok(
              entry === undefined || entry.handled,
              `${where}: ${id} still open after ${outcome}`,
            );
          } else {
            // Dry early keeps the plant due, with a note.
            assert.ok(
              entry?.loggedToday.includes(outcome),
              `${where}: ${outcome} not shown for ${id}; before=${before.join(",")} entry=${JSON.stringify(entry)} plant=${JSON.stringify(w.data.plants.find((p) => p.id === id))} reason=${JSON.stringify(makePlan(w.data, w.today).plants.find((p) => p.plantId === id)?.waterings[0])} prefs=${JSON.stringify(w.data.settings.prefs)}`,
            );
          }
          w.data = next;
        } else if (roll < 0.5) {
          const open = dayEntries(makePlan(w.data, w.today), w.data, w.today).filter(
            (e) => !e.handled,
          );
          const next = waterAll(
            w.data,
            open.map((e) => e.plantId),
            w.today,
          );
          const left = dayEntries(makePlan(next, w.today), next, w.today);
          assert.ok(
            left.every((e) => e.handled),
            `${where}: water all left open plants`,
          );
          w.data = next;
        } else if (roll < 0.7) {
          const delta = int(-10, 10);
          const to = addDays(w.today, delta);
          const here = makePlan(w.data, w.today);
          w.today = to;
          // Round trip: going back to where we were shows the same plan.
          const back = addDays(to, -delta);
          assert.deepEqual(makePlan(w.data, back), here, `${where}: date round trip`);
        } else if (roll < 0.8) {
          const from = addDays(w.today, int(0, 20));
          const range = addAwayRange(w.data, from, addDays(from, int(0, 6)));
          assert.ok(range);
          w.data = range;
        } else if (roll < 0.83) {
          // "Can't water today": today leaves the plan, and removing the away date undoes it.
          const wasAway = w.data.spaces[0]?.awayDates.includes(w.today) === true;
          const next = cantWaterToday(w.data, w.today);
          assert.deepEqual(makePlan(next, w.today).plants.length, w.data.plants.length);
          assert.ok(
            !makePlan(next, w.today).days.some((x) => x.date === w.today),
            `${where}: planned on a day marked can't water`,
          );
          if (!wasAway) {
            assert.deepEqual(
              makePlan(removeAwayDate(next, w.today), w.today),
              makePlan(w.data, w.today),
              `${where}: can't water today did not undo`,
            );
          }
          w.data = next;
        } else if (roll < 0.85) {
          const first = w.data.spaces[0]?.awayDates[0];
          if (first !== undefined) w.data = removeAwayDate(w.data, first);
        } else if (roll < 0.9) {
          w.data = setPrefs(w.data, { preLeaveWatering: r() < 0.5 });
        } else if (roll < 0.95 && w.data.plants.length > 0) {
          const p = w.data.plants[int(0, w.data.plants.length - 1)];
          assert.ok(p);
          w.data = updatePlant(w.data, { ...p, intervalDays: int(2, 30) });
        } else if (w.data.plants.length > 3) {
          const p = w.data.plants[int(0, w.data.plants.length - 1)];
          assert.ok(p);
          const gone = deletePlant(w.data, p.id);
          assert.ok(!ids(gone, w.today).includes(p.id), `${where}: deleted plant on Today`);
          w.data = gone;
        } else {
          w.data = addPlant(w.data, {
            name: "New",
            style: "let_top_dry",
            intervalDays: int(3, 20),
            lastWatered: addDays(w.today, -int(0, 5)),
            logs: [],
          });
        }
        checkState(w, where);
        // Export then import gives an identical plan.
        const round = importData(exportData(w.data));
        assert.deepEqual(round.warnings, [], `${where}: export warnings`);
        assert.deepEqual(
          makePlan(round.data, w.today),
          makePlan(w.data, w.today),
          `${where}: round trip`,
        );
      }
    }
  });

  it("a plant never leaves Today unless it was logged or something else explains it", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const r = rng(seed * 7);
      const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
      let data = fixtureData(START);
      let today = START;
      for (let step = 0; step < 30; step += 1) {
        const before = ids(data, today);
        // Rule 23: a plant that only joined today (its window opens later) goes back to its
        // own day when the plants that set today are snoozed or skipped, so it may leave unlogged.
        const joinedEarly = new Set(
          makePlan(data, today)
            .plants.filter((p) =>
              p.waterings.some((w) => w.date === today && w.windowEarliest > today),
            )
            .map((p) => p.plantId),
        );
        const id = before[int(0, Math.max(0, before.length - 1))];
        if (id !== undefined) data = logOutcome(data, id, OUTCOMES[int(0, 3)] as LogOutcome, today);
        for (const gone of before.filter((x) => !ids(data, today).includes(x))) {
          assert.ok(
            loggedOn(data, gone, today) || joinedEarly.has(gone),
            `seed ${seed} step ${step}: ${gone} vanished unlogged`,
          );
        }
        // Time passes one day at a time, like a real user opening the app each morning.
        today = addDays(today, 1);
      }
    }
  });

  it("logs dated after the displayed day do not change that day's plan", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const r = rng(seed * 13);
      const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
      let data = fixtureData(START);
      const future = addDays(START, int(3, 12));
      for (const id of ids(data, START)) data = logOutcome(data, id, "done", START);
      // The user advances the date, logs, then goes back to look at an earlier day.
      for (const p of data.plants) data = logOutcome(data, p.id, "done", future);
      const view = addDays(START, 1);
      const stripped: AppData = {
        ...data,
        plants: data.plants.map((p) => ({
          ...p,
          logs: (p.logs ?? []).filter((l) => l.date <= view),
        })),
      };
      assert.deepEqual(makePlan(data, view), makePlan(stripped, view), `seed ${seed}`);
    }
  });
});

describe("app.ts markup audit (no browser)", () => {
  const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

  it("every text, number and date input opts out of autofill", () => {
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (/type="(checkbox|file)"/.test(tag)) continue;
      assert.match(tag, /autocomplete="off"|\$\{NO_FILL\}/, tag);
    }
  });

  it("no field is named like a login or a person", () => {
    assert.doesNotMatch(src, /name="(name|email|username|user|password|pass|phone|address)"/);
    assert.doesNotMatch(src, /type="(password|email)"/);
  });

  it("every repeated button carries the item in its accessible name", () => {
    for (const action of ["log", "edit", "delete", "delete-room", "remove-away"]) {
      for (const m of src.matchAll(new RegExp(`<button data-action="${action}"[^>]*>`, "g"))) {
        assert.match(m[0], /aria-label=/, m[0]);
      }
    }
  });

  it("every labelled control sits inside a label or has for=", () => {
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      const at = m.index;
      const before = src.slice(Math.max(0, at - 400), at);
      assert.ok(
        before.lastIndexOf("<label") > before.lastIndexOf("</label>") || /id="today"/.test(m[0]),
        m[0],
      );
    }
  });
});

describe("phase 0 UI (markup and helpers)", () => {
  const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

  it("Today offers Done, Skip and Still wet; Dry early is on the plant cards", () => {
    const buttons = src.slice(
      src.indexOf("function outcomeButtons"),
      src.indexOf("function todayNote"),
    );
    assert.doesNotMatch(buttons, /dry_early/);
    assert.match(src.slice(src.indexOf("function plantCard")), /data-outcome="dry_early"/);
  });

  it("has the five tabs, kept in the hash", () => {
    // The tab list itself is in tabs.ts (Holidays became Planning); see planning-tab.test.ts.
    assert.match(src, /TABS\.map\(/);
    assert.match(src, /role="tablist"/);
    assert.match(src, /aria-selected=/);
    assert.match(src, /location\.hash/);
  });

  // The old inline plant form is gone: its required/optional and order checks now live in
  // modal.test.ts against modalHtml.

  it("randomName is deterministic for a given random source and uses the lists", () => {
    assert.equal(
      randomName(() => 0),
      `${ADJECTIVES[0]} ${NOUNS[0]}`,
    );
    assert.equal(
      randomName(() => 0.999999),
      `${ADJECTIVES.at(-1)} ${NOUNS.at(-1)}`,
    );
    assert.equal(
      randomName(() => 0.5),
      randomName(() => 0.5),
    );
  });
});

describe("Today bulk buttons markup", () => {
  const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const today = src.slice(
    src.indexOf("function todaySection"),
    src.indexOf("function calendarSection"),
  );

  it("Water all and Can't water today sit above the plant list; Mark all done is gone", () => {
    assert.ok(today.includes('data-action="water-all"'));
    assert.ok(today.includes('data-action="cant-water"'));
    assert.ok(today.indexOf('data-action="water-all"') < today.indexOf("<ul>${list}</ul>"));
    assert.ok(today.indexOf('data-action="cant-water"') < today.indexOf("<ul>${list}</ul>"));
    assert.ok(!src.includes("Mark all done") && !src.includes("all-done"));
  });

  it("both buttons ask for confirmation before changing anything", () => {
    const handler = src.slice(src.indexOf('case "water-all"'), src.indexOf('case "tab"'));
    assert.equal(handler.match(/confirm\(/g)?.length, 2);
    assert.match(handler, /bulkConfirmText/);
  });
});
