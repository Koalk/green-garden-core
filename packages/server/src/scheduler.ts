// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The impure shell around the reminder core: reads each space, asks the core what is due, sends
 * through a `MailTransport` and records it. Clock and transport are injected, so tests drive it with a
 * fixed `now` and a fake transport. Reminder state lives beside the space file and never touches the
 * data revision.
 */
import { importData, type ReminderSettings } from "@green-garden/storage";
import { localDate, localMinutes } from "./clock.ts";
import type { SpaceFiles } from "./files.ts";
import type { MailTransport } from "./mail.ts";
import { dueReminder, recordSent } from "./reminders.ts";

export interface TickDeps {
  readonly files: SpaceFiles;
  readonly now: Date;
  /** The SMTP password from the server's environment. */
  readonly password: string;
  readonly makeTransport: (smtp: ReminderSettings["smtp"], password: string) => MailTransport;
}

export interface TickResult {
  readonly sent: readonly { readonly space: string; readonly plantIds: readonly string[] }[];
  readonly errors: readonly string[];
}

export async function runReminderTick(deps: TickDeps): Promise<TickResult> {
  const sent: { space: string; plantIds: readonly string[] }[] = [];
  const errors: string[] = [];
  const today = localDate(deps.now);
  for (const space of await deps.files.names()) {
    const file = await deps.files.read(space);
    if (file === undefined) continue;
    const data = importData(JSON.stringify(file.data)).data;
    const settings = data.settings.reminders;
    if (settings === undefined) continue;
    const state = await deps.files.readState(space);
    const due = dueReminder({ data, today, minutes: localMinutes(deps.now), state });
    if (due === undefined) continue;
    try {
      const n = due.names.length;
      await deps.makeTransport(settings.smtp, deps.password).send({
        to: settings.email,
        from: settings.smtp.from ?? settings.smtp.user ?? settings.email,
        subject: `Water ${String(n)} ${n === 1 ? "plant" : "plants"} today`,
        text: `Water today:\n${due.names.map((x) => `- ${x}`).join("\n")}\n`,
      });
      await deps.files.writeState(space, recordSent(state, due.plantIds, today));
      sent.push({ space, plantIds: due.plantIds });
    } catch (e) {
      errors.push(`${space}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }
  return { sent, errors };
}

/** Runs a tick every `intervalMs`; returns a function that stops it. Not unit-tested: it is a timer. */
export function startScheduler(
  deps: Omit<TickDeps, "now">,
  log: (line: string) => void,
  intervalMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    runReminderTick({ ...deps, now: new Date() }).then(
      (r) => {
        for (const s of r.sent)
          log(`reminder sent for ${s.space}: ${String(s.plantIds.length)} plants`);
        for (const e of r.errors) log(`reminder failed: ${e}`);
      },
      (e: unknown) => {
        log(`reminder tick failed: ${e instanceof Error ? e.message : "unknown error"}`);
      },
    );
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
