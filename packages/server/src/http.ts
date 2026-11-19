// SPDX-License-Identifier: AGPL-3.0-only

/** The thin socket layer around the pure handler; everything testable lives in `app.ts`. */
import { createServer, type Server } from "node:http";
import type { App } from "./app.ts";

const MAX_BODY = 5_000_000;

export function createHttpServer(app: App): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) {
        res.writeHead(413, { "content-type": "text/plain" }).end("too large");
        return;
      }
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      app
        .handle({
          method: req.method ?? "GET",
          path: req.url ?? "/",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
        .then((r) => res.writeHead(r.status, r.headers).end(r.body))
        .catch(() => res.writeHead(500, { "content-type": "text/plain" }).end("server error"));
    });
  });
}
