// SPDX-License-Identifier: AGPL-3.0-only

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Wire } from "./mqtt.ts";

/** The real wire: a TCP or TLS socket to the broker. Not covered by tests (the no-network gate). */
export function openMqttSocket(host: string, port: number, tls: boolean): Wire {
  const socket: Socket = tls ? tlsConnect({ host, port }) : netConnect({ host, port });
  return {
    write: (bytes) => {
      socket.write(bytes);
    },
    end: () => {
      socket.end();
    },
    listen: (onData, onClose) => {
      socket.on("data", (b: Buffer) => {
        onData(b);
      });
      socket.on("error", () => undefined); // the close event follows and is handled
      socket.on("close", onClose);
    },
  };
}
