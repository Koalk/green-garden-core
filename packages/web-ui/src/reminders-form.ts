// SPDX-License-Identifier: AGPL-3.0-only

/** The email reminder settings form: the pure parts. The SMTP password stays in the server env. */
import {
  DEFAULT_REMINDER_TIME,
  type AppData,
  type ReminderSettings,
  type Settings,
} from "@green-garden/storage";
import { esc, t } from "./text.ts";

/** The raw form fields, as typed. */
export interface RemindersInput {
  readonly enabled: boolean;
  readonly time: string;
  readonly email: string;
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly secure: string;
  readonly from: string;
}

const SECURES = ["starttls", "tls", "none"] as const;

/**
 * Stores the reminder settings. An empty address and host clear them; only one of the two is
 * refused (`undefined`), as is a time that is not `HH:MM` (blank means 08:00).
 */
export function setReminders(data: AppData, f: RemindersInput): AppData | undefined {
  const email = f.email.trim();
  const host = f.host.trim();
  const rest: Settings = { ...data.settings };
  delete (rest as { reminders?: ReminderSettings }).reminders;
  if (email === "" && host === "") return { ...data, settings: rest };
  if (email === "" || host === "") return undefined;
  const time = f.time.trim() === "" ? DEFAULT_REMINDER_TIME : f.time.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  const port = Number(f.port);
  const user = f.user.trim();
  const from = f.from.trim();
  const secure = SECURES.find((s) => s === f.secure);
  const reminders: ReminderSettings = {
    enabled: f.enabled,
    time,
    email,
    smtp: {
      host,
      ...(f.port.trim() !== "" && Number.isInteger(port) && port > 0 && port < 65536
        ? { port }
        : {}),
      ...(user === "" ? {} : { user }),
      ...(secure === undefined ? {} : { secure }),
      ...(from === "" ? {} : { from }),
    },
  };
  return { ...data, settings: { ...data.settings, reminders } };
}

/** The form for the Data tab, filled from the stored settings. */
export function remindersHtml(data: AppData): string {
  const r = data.settings.reminders;
  const v = (s: string | number | undefined): string => esc(String(s ?? ""));
  const secure = r?.smtp.secure ?? "starttls";
  const opt = (x: string, label: string): string =>
    `<option value="${x}"${secure === x ? " selected" : ""}>${esc(label)}</option>`;
  return `<h3>${esc(t("reminders.heading"))}</h3>
    <form data-form="reminders"><p>${esc(t("reminders.intro"))}</p>
    <p><label><input type="checkbox" name="enabled"${r?.enabled === true ? " checked" : ""}> ${esc(t("reminders.enabled"))}</label></p>
    <p><label>${esc(t("reminders.time"))} <input name="time" type="time" autocomplete="off" value="${v(r?.time ?? DEFAULT_REMINDER_TIME)}"></label>
    <label>${esc(t("reminders.email"))} <input name="email" type="email" autocomplete="off" value="${v(r?.email)}"></label></p>
    <p><label>${esc(t("reminders.host"))} <input name="host" autocomplete="off" value="${v(r?.smtp.host)}"></label>
    <label>${esc(t("reminders.port"))} <input name="port" type="number" min="1" max="65535" autocomplete="off" value="${v(r?.smtp.port)}"></label>
    <label>${esc(t("reminders.secure"))} <select name="secure">${opt("starttls", t("reminders.starttls"))}${opt("tls", t("reminders.tls"))}${opt("none", t("reminders.none"))}</select></label></p>
    <p><label>${esc(t("reminders.user"))} <input name="user" autocomplete="off" value="${v(r?.smtp.user)}"></label>
    <label>${esc(t("reminders.from"))} <input name="from" autocomplete="off" value="${v(r?.smtp.from)}"></label></p>
    <p><small>${esc(t("reminders.password"))}</small></p>
    <button type="submit">${esc(t("reminders.save"))}</button></form>`;
}
