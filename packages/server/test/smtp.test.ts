// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SmtpTransport, type SmtpConnection, type SmtpReply } from "../src/index.ts";

/** A scripted server: answers each command by its first word; records what the client wrote. */
function fakeConnection(overrides: Record<string, SmtpReply> = {}): {
  conn: SmtpConnection;
  written: string[];
  events: string[];
} {
  const written: string[] = [];
  const events: string[] = [];
  const queue: SmtpReply[] = [{ code: 220, lines: ["ready"] }];
  const answers: Record<string, SmtpReply> = {
    EHLO: { code: 250, lines: ["hi", "AUTH PLAIN"] },
    STARTTLS: { code: 220, lines: ["go"] },
    AUTH: { code: 235, lines: ["ok"] },
    MAIL: { code: 250, lines: ["ok"] },
    RCPT: { code: 250, lines: ["ok"] },
    DATA: { code: 354, lines: ["go"] },
    QUIT: { code: 221, lines: ["bye"] },
    ...overrides,
  };
  let inData = false;
  const conn: SmtpConnection = {
    write(text) {
      written.push(text);
      if (inData) {
        if (text.endsWith("\r\n.\r\n")) {
          inData = false;
          queue.push({ code: 250, lines: ["queued"] });
        }
        return;
      }
      const word = text.trim().split(" ")[0] ?? "";
      const a = answers[word];
      if (a !== undefined) queue.push(a);
      if (word === "DATA") inData = true;
    },
    read() {
      const next = queue.shift();
      return Promise.resolve(next ?? { code: 421, lines: ["no answer"] });
    },
    upgradeTls() {
      events.push("tls");
      return Promise.resolve();
    },
    close() {
      events.push("close");
    },
  };
  return { conn, written, events };
}

const message = {
  to: "me@example.org",
  from: "garden@example.org",
  subject: "Water 2 plants today",
  text: "Water today:\n- Fern\n- Ficus",
};

describe("SmtpTransport (fake connection)", () => {
  it("speaks EHLO, AUTH, MAIL, RCPT, DATA, QUIT in order", async () => {
    const { conn, written, events } = fakeConnection();
    const transport = new SmtpTransport(() => Promise.resolve(conn), {
      host: "smtp.example.org",
      user: "me",
      password: "pw",
      secure: "none",
      heloName: "gg.local",
    });
    await transport.send(message);
    const cmds = written.map((w) => w.trim().split(" ")[0]);
    assert.deepEqual(cmds.slice(0, 5), ["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
    assert.ok(written.some((w) => w.startsWith("MAIL FROM:<garden@example.org>")));
    assert.ok(written.some((w) => w.startsWith("RCPT TO:<me@example.org>")));
    assert.ok(
      written.some((w) => w.startsWith("AUTH PLAIN " + Buffer.from("\0me\0pw").toString("base64"))),
    );
    assert.equal(written.at(-1)?.trim(), "QUIT");
    assert.deepEqual(events, ["close"]);
    const data = written.find((w) => w.includes("Subject:")) ?? "";
    assert.ok(data.includes("To: me@example.org"));
    assert.ok(data.endsWith("\r\n.\r\n"));
    assert.ok(!data.includes("Fern"), "the body is base64, not plain");
    assert.ok(data.includes(Buffer.from(message.text).toString("base64")));
  });

  it("upgrades with STARTTLS and says EHLO again", async () => {
    const { conn, written, events } = fakeConnection();
    const transport = new SmtpTransport(() => Promise.resolve(conn), {
      host: "smtp.example.org",
      secure: "starttls",
      heloName: "gg.local",
    });
    await transport.send(message);
    const cmds = written.map((w) => w.trim().split(" ")[0]);
    assert.deepEqual(cmds.slice(0, 4), ["EHLO", "STARTTLS", "EHLO", "MAIL"]);
    assert.deepEqual(events, ["tls", "close"]);
  });

  it("fails with the server's refusal and still closes", async () => {
    const { conn, events } = fakeConnection({ RCPT: { code: 550, lines: ["no such user"] } });
    const transport = new SmtpTransport(() => Promise.resolve(conn), {
      host: "smtp.example.org",
      secure: "none",
      heloName: "gg.local",
    });
    await assert.rejects(transport.send(message), /550/);
    assert.deepEqual(events, ["close"]);
  });

  it("refuses header injection through the subject or addresses", async () => {
    const { conn } = fakeConnection();
    const transport = new SmtpTransport(() => Promise.resolve(conn), {
      host: "h",
      secure: "none",
      heloName: "gg.local",
    });
    await assert.rejects(transport.send({ ...message, subject: "x\r\nBcc: evil@example.org" }));
    await assert.rejects(transport.send({ ...message, to: "a@b.c>\r\nRCPT TO:<x@y.z" }));
  });

  it("needs the password when a user is set", async () => {
    const { conn } = fakeConnection();
    const transport = new SmtpTransport(() => Promise.resolve(conn), {
      host: "h",
      user: "me",
      secure: "none",
      heloName: "gg.local",
    });
    await assert.rejects(transport.send(message), /password/);
  });
});
