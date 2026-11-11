// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { emptyData, exportData, type AppData } from "@green-garden/storage";
import { SpaceFiles, runReminderTick, type MailMessage, type MailTransport } from "../src/index.ts";

let dir = "";
let files: SpaceFiles;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-sched-"));
  files = new SpaceFiles(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (h: number, m = 0, day = 2): Date => new Date(2026, 10, day, h, m);

function data(enabled = true): AppData {
  const base = emptyData();
  return {
    ...base,
    plants: [
      {
        id: "p1",
        spaceId: "space1",
        name: "Fern",
        style: "keep_moist",
        intervalDays: 4,
        lastWatered: "2026-10-29",
        logs: [],
      },
    ],
    settings: {
      ...base.settings,
      reminders: {
        enabled,
        time: "08:00",
        email: "me@example.org",
        smtp: { host: "smtp.example.org", user: "me" },
      },
    },
  };
}

async function seed(d: AppData): Promise<void> {
  await files.update("default", () => ({
    file: { revision: 1, data: JSON.parse(exportData(d)) as unknown },
    result: undefined,
  }));
}

function one(sent: MailMessage[]): MailMessage {
  const m = sent[0];
  assert.ok(m);
  return m;
}

function fakeMail(fail = false): { transport: MailTransport; sent: MailMessage[]; seen: string[] } {
  const sent: MailMessage[] = [];
  const seen: string[] = [];
  return {
    sent,
    seen,
    transport: {
      send(m) {
        if (fail) return Promise.reject(new Error("smtp down"));
        sent.push(m);
        return Promise.resolve();
      },
    },
  };
}

describe("reminder scheduler tick", () => {
  it("sends one email at the set time and not again the same day", async () => {
    await seed(data());
    const mail = fakeMail();
    const deps = { files, password: "pw", makeTransport: () => mail.transport };
    await runReminderTick({ ...deps, now: at(7, 59) });
    assert.equal(mail.sent.length, 0, "too early");
    const first = await runReminderTick({ ...deps, now: at(8, 0) });
    assert.equal(mail.sent.length, 1);
    assert.equal(one(mail.sent).to, "me@example.org");
    assert.equal(one(mail.sent).from, "me");
    assert.match(one(mail.sent).subject, /1 plant/);
    assert.ok(one(mail.sent).text.includes("Fern"));
    assert.equal(first.sent.length, 1);
    await runReminderTick({ ...deps, now: at(9, 30) });
    assert.equal(mail.sent.length, 1, "once a day");
  });

  it("hands the password only to the transport factory", async () => {
    await seed(data());
    const mail = fakeMail();
    let got = "";
    await runReminderTick({
      files,
      now: at(8),
      password: "s3cret",
      makeTransport: (_smtp, password) => {
        got = password;
        return mail.transport;
      },
    });
    assert.equal(got, "s3cret");
    assert.ok(!one(mail.sent).text.includes("s3cret"));
  });

  it("keeps the day open for a retry when sending fails", async () => {
    await seed(data());
    const down = fakeMail(true);
    const r = await runReminderTick({
      files,
      now: at(8),
      password: "pw",
      makeTransport: () => down.transport,
    });
    assert.equal(r.sent.length, 0);
    assert.equal(r.errors.length, 1);
    const up = fakeMail();
    await runReminderTick({
      files,
      now: at(8, 1),
      password: "pw",
      makeTransport: () => up.transport,
    });
    assert.equal(up.sent.length, 1);
  });

  it("stops a plant after 3 unactioned reminders across days", async () => {
    await seed(data());
    const mail = fakeMail();
    const deps = { files, password: "pw", makeTransport: () => mail.transport };
    // the plant stays overdue and nobody logs anything: reminders on days 2, 3, 4, then silence
    for (const day of [2, 3, 4, 5, 6]) await runReminderTick({ ...deps, now: at(8, 0, day) });
    assert.equal(mail.sent.length, 3);
  });

  it("does nothing when reminders are off", async () => {
    await seed(data(false));
    const mail = fakeMail();
    await runReminderTick({
      files,
      now: at(9),
      password: "pw",
      makeTransport: () => mail.transport,
    });
    assert.equal(mail.sent.length, 0);
  });

  it("does not bump the data revision", async () => {
    await seed(data());
    const mail = fakeMail();
    await runReminderTick({
      files,
      now: at(9),
      password: "pw",
      makeTransport: () => mail.transport,
    });
    assert.equal((await files.read("default"))?.revision, 1);
  });
});
