// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mail transport behind an interface. Tests use a fake `MailTransport` or a fake
 * `SmtpConnection`; the real socket lives in `smtp-socket.ts` and is never called in tests.
 */
import { Buffer } from "node:buffer";

export interface MailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailTransport {
  /** Resolves when the server accepted the message; rejects with a readable reason otherwise. */
  send(message: MailMessage): Promise<void>;
}

export interface SmtpReply {
  readonly code: number;
  readonly lines: readonly string[];
}

/** One SMTP session as lines in, replies out. */
export interface SmtpConnection {
  /** Writes text exactly as given (the caller adds CRLF). */
  write(text: string): void;
  read(): Promise<SmtpReply>;
  /** Upgrades the open connection to TLS (after STARTTLS). */
  upgradeTls(): Promise<void>;
  close(): void;
}

export interface SmtpOptions {
  readonly host: string;
  readonly user?: string;
  /** From the server's environment, never from the stored settings. */
  readonly password?: string;
  readonly secure: "tls" | "starttls" | "none";
  /** Name given in EHLO. */
  readonly heloName: string;
}

function clean(value: string, what: string): string {
  if (/[\r\n<>]/.test(value)) throw new Error(`${what} contains forbidden characters`);
  return value;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

export class SmtpTransport implements MailTransport {
  private readonly connect: () => Promise<SmtpConnection>;
  private readonly options: SmtpOptions;
  constructor(connect: () => Promise<SmtpConnection>, options: SmtpOptions) {
    this.connect = connect;
    this.options = options;
  }

  async send(message: MailMessage): Promise<void> {
    const to = clean(message.to, "recipient");
    const from = clean(message.from, "sender");
    const subject = encodeHeader(clean(message.subject, "subject"));
    const { user, password } = this.options;
    if (user !== undefined && (password === undefined || password === "")) {
      throw new Error("SMTP password is not set (GREEN_GARDEN_SMTP_PASSWORD)");
    }
    const conn = await this.connect();
    try {
      const expect = async (...codes: number[]): Promise<void> => {
        const r = await conn.read();
        if (!codes.includes(r.code)) throw new Error(`SMTP ${String(r.code)} ${r.lines.join(" ")}`);
      };
      const cmd = async (line: string, ...codes: number[]): Promise<void> => {
        conn.write(`${line}\r\n`);
        await expect(...codes);
      };
      await expect(220);
      await cmd(`EHLO ${this.options.heloName}`, 250);
      if (this.options.secure === "starttls") {
        await cmd("STARTTLS", 220);
        await conn.upgradeTls();
        await cmd(`EHLO ${this.options.heloName}`, 250);
      }
      if (user !== undefined && password !== undefined) {
        const token = Buffer.from(`\0${user}\0${password}`, "utf8").toString("base64");
        await cmd(`AUTH PLAIN ${token}`, 235);
      }
      await cmd(`MAIL FROM:<${from}>`, 250);
      await cmd(`RCPT TO:<${to}>`, 250, 251);
      await cmd("DATA", 354);
      const body = wrap76(Buffer.from(message.text, "utf8").toString("base64"));
      const data = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
      ].join("\r\n");
      conn.write(`${data}\r\n.\r\n`);
      await expect(250);
      conn.write("QUIT\r\n");
    } finally {
      conn.close();
    }
  }
}
