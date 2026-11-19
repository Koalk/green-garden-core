// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The real SMTP socket (Node's own `net` and `tls`, no dependency). Not exercised by tests: they use a
 * fake `SmtpConnection`, so nothing ever opens a connection to a mail server.
 */
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { SmtpConnection, SmtpReply } from "./mail.ts";

const TIMEOUT_MS = 30_000;

export function openSmtp(
  host: string,
  port: number,
  secure: "tls" | "starttls" | "none",
): Promise<SmtpConnection> {
  return new Promise((resolve, reject) => {
    let socket: Socket =
      secure === "tls" ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
    let buffer = "";
    let failure: Error | undefined;
    const waiting: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void }[] = [];
    const replies: SmtpReply[] = [];
    let partial: string[] = [];

    const settle = (): void => {
      for (let r = replies.shift(); r !== undefined; r = replies.shift()) {
        const w = waiting.shift();
        if (w === undefined) {
          replies.unshift(r);
          break;
        }
        w.resolve(r);
      }
      if (failure !== undefined)
        for (let w = waiting.shift(); w; w = waiting.shift()) w.reject(failure);
    };
    const attach = (s: Socket): void => {
      s.setTimeout(TIMEOUT_MS, () => {
        failure = new Error("SMTP connection timed out");
        s.destroy();
        settle();
      });
      s.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          partial.push(line.slice(4));
          if (line.length >= 4 && line[3] === " ") {
            replies.push({ code: Number(line.slice(0, 3)), lines: partial });
            partial = [];
          }
        }
        settle();
      });
      s.on("error", (e: Error) => {
        failure = e;
        settle();
      });
      s.on("close", () => {
        failure ??= new Error("SMTP connection closed");
        settle();
      });
    };
    attach(socket);
    socket.once("error", reject);
    socket.once(secure === "tls" ? "secureConnect" : "connect", () => {
      socket.removeListener("error", reject);
      resolve({
        write: (text) => {
          socket.write(text);
        },
        read: () =>
          new Promise<SmtpReply>((res, rej) => {
            waiting.push({ resolve: res, reject: rej });
            settle();
          }),
        upgradeTls: () =>
          new Promise<void>((res, rej) => {
            socket.removeAllListeners("data");
            const upgraded = tlsConnect({ socket, servername: host }, () => {
              socket = upgraded;
              res();
            });
            attach(upgraded);
            upgraded.once("error", rej);
          }),
        close: () => {
          socket.destroy();
        },
      });
    });
  });
}
