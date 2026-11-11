// SPDX-License-Identifier: AGPL-3.0-only

import type { ReminderSettings } from "@green-garden/storage";
import { SmtpTransport, type MailTransport } from "./mail.ts";
import { openSmtp } from "./smtp-socket.ts";

type Smtp = ReminderSettings["smtp"];

/** Port and security for a settings block: whichever is missing follows the other (587 STARTTLS by default). */
export function smtpEndpoint(smtp: Smtp): { port: number; secure: "tls" | "starttls" | "none" } {
  const secure =
    smtp.secure ?? (smtp.port === 465 ? "tls" : smtp.port === 25 ? "none" : "starttls");
  const port = smtp.port ?? (secure === "tls" ? 465 : secure === "none" ? 25 : 587);
  return { port, secure };
}

/** The real transport: Node's sockets, the password from the environment. */
export function makeSmtpTransport(smtp: Smtp, password: string): MailTransport {
  const { port, secure } = smtpEndpoint(smtp);
  return new SmtpTransport(() => openSmtp(smtp.host, port, secure), {
    host: smtp.host,
    ...(smtp.user === undefined ? {} : { user: smtp.user, password }),
    secure,
    heloName: "green-garden.local",
  });
}
