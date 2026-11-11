// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, exportData, importData, type AppData } from "../src/index.ts";

const base = emptyData();
const withReminders: AppData = {
  ...base,
  settings: {
    ...base.settings,
    reminders: {
      enabled: true,
      time: "07:30",
      email: "me@example.org",
      smtp: { host: "smtp.example.org", port: 587, user: "me", secure: "starttls" },
    },
  },
};

describe("email reminder settings", () => {
  it("round-trips through export and import", () => {
    assert.deepEqual(importData(exportData(withReminders)).data.settings.reminders, {
      enabled: true,
      time: "07:30",
      email: "me@example.org",
      smtp: { host: "smtp.example.org", port: 587, user: "me", secure: "starttls" },
    });
  });

  it("is absent when never set", () => {
    assert.equal(importData(exportData(base)).data.settings.reminders, undefined);
  });

  it("defaults the time to 08:00 and ignores a malformed one", () => {
    const raw = JSON.parse(exportData(withReminders)) as {
      settings: { reminders: Record<string, unknown> };
    };
    raw.settings.reminders["time"] = "25:99";
    const r = importData(JSON.stringify(raw)).data.settings.reminders;
    assert.equal(r?.time, "08:00");
  });

  it("never keeps a password, even if a file carries one", () => {
    const raw = JSON.parse(exportData(withReminders)) as {
      settings: { reminders: { smtp: Record<string, unknown> } };
    };
    raw.settings.reminders.smtp["password"] = "hunter2";
    const out = exportData(importData(JSON.stringify(raw)).data);
    assert.ok(!out.includes("hunter2"));
  });

  it("drops reminders without an address or host", () => {
    const raw = JSON.parse(exportData(withReminders)) as {
      settings: { reminders: Record<string, unknown> };
    };
    raw.settings.reminders["email"] = "";
    assert.equal(importData(JSON.stringify(raw)).data.settings.reminders, undefined);
  });
});
