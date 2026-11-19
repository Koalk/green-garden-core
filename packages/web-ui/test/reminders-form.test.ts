// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyData, exportData, importData } from "@green-garden/storage";
import { remindersHtml, setReminders } from "../src/index.ts";

const input = {
  enabled: true,
  time: "07:30",
  email: " me@example.org ",
  host: "smtp.example.org",
  port: "587",
  user: "me",
  secure: "starttls",
  from: "",
};

describe("reminder settings form", () => {
  it("stores the settings in the shape the server reads, trimmed, with no password", () => {
    const r = setReminders(emptyData(), input);
    assert.ok(r !== undefined);
    assert.deepEqual(r.settings.reminders, {
      enabled: true,
      time: "07:30",
      email: "me@example.org",
      smtp: { host: "smtp.example.org", port: 587, user: "me", secure: "starttls" },
    });
    assert.doesNotMatch(exportData(r), /pass/i);
    assert.deepEqual(importData(exportData(r)).data.settings.reminders, r.settings.reminders);
  });

  it("falls back to 08:00 and drops a bad port or unknown security mode", () => {
    const r = setReminders(emptyData(), { ...input, time: "", port: "99999", secure: "weird" });
    assert.ok(r?.settings.reminders !== undefined);
    assert.equal(r.settings.reminders.time, "08:00");
    assert.deepEqual(r.settings.reminders.smtp, { host: "smtp.example.org", user: "me" });
  });

  it("refuses an address or host that is missing while only one of them is given", () => {
    assert.equal(setReminders(emptyData(), { ...input, email: "" }), undefined);
    assert.equal(setReminders(emptyData(), { ...input, host: " " }), undefined);
  });

  it("an empty form clears the settings", () => {
    const set = setReminders(emptyData(), input);
    assert.ok(set !== undefined);
    const cleared = setReminders(set, { ...input, enabled: false, email: "", host: "" });
    assert.ok(cleared !== undefined);
    assert.equal(cleared.settings.reminders, undefined);
  });

  it("the form shows the stored values, escaped, and says the password lives in the server env", () => {
    const set = setReminders(emptyData(), { ...input, user: 'a"b' });
    assert.ok(set !== undefined);
    const html = remindersHtml(set);
    assert.match(html, /data-form="reminders"/);
    assert.match(html, /name="time"[^>]*value="07:30"/);
    assert.match(html, /name="email"[^>]*value="me@example.org"/);
    assert.match(html, /value="a&#34;b"/);
    assert.match(html, /name="enabled"[^>]*checked/);
    assert.match(html, /GREEN_GARDEN_SMTP_PASSWORD/);
    assert.doesNotMatch(html, /type="password"/);
    assert.doesNotMatch(remindersHtml(emptyData()), /name="enabled"[^>]*checked/);
    assert.match(remindersHtml(emptyData()), /name="time"[^>]*value="08:00"/);
  });
});

describe("app.ts wiring", () => {
  it("shows the form in the Data tab and saves it through setReminders", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${import.meta.dirname}/../src/app.ts`, "utf8");
    assert.match(src, /remindersHtml\(data\)/);
    assert.match(src, /case "reminders":/);
    assert.match(src, /setReminders\(data,/);
  });
});
