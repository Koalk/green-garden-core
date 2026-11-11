// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A small MQTT 3.1.1 client, written for this repo (no library, like the SMTP client in the server):
 * QoS 0 only, which is all Home Assistant discovery and button topics need. Retained messages carry the
 * state, so a lost message is repaired by the next sync. The packet codec is pure and tested byte for
 * byte; `MqttTransport` drives it over a `Wire` (a socket in `mqtt-socket.ts`, a fake in tests).
 */
import type { Msg } from "./entities.ts";
import type { HaTransport } from "./bridge.ts";

const enc = (s: string): Buffer => Buffer.from(s, "utf8");
const u16 = (n: number): Buffer => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const str = (s: string): Buffer => {
  const b = enc(s);
  return Buffer.concat([u16(b.length), b]);
};

function remainingLength(n: number): Buffer {
  const out: number[] = [];
  let x = n;
  do {
    let digit = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) digit |= 0x80;
    out.push(digit);
  } while (x > 0);
  return Buffer.from(out);
}

function packet(first: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([first]), remainingLength(body.length), body]);
}

export interface Will {
  readonly topic: string;
  readonly payload: string;
  readonly retain: boolean;
}

export interface ConnectOptions {
  readonly clientId: string;
  readonly keepAliveSeconds: number;
  readonly username?: string;
  readonly password?: string;
  readonly will?: Will;
}

export function encodeConnect(o: ConnectOptions): Buffer {
  let flags = 0x02; // clean session
  const payload: Buffer[] = [str(o.clientId)];
  if (o.will !== undefined) {
    flags |= 0x04 | (o.will.retain ? 0x20 : 0);
    payload.push(str(o.will.topic), str(o.will.payload));
  }
  if (o.username !== undefined) {
    flags |= 0x80;
    payload.push(str(o.username));
    if (o.password !== undefined) {
      flags |= 0x40;
      payload.push(str(o.password));
    }
  }
  const head = Buffer.concat([str("MQTT"), Buffer.from([4, flags]), u16(o.keepAliveSeconds)]);
  return packet(0x10, Buffer.concat([head, ...payload]));
}

export function encodePublish(m: Msg): Buffer {
  return packet(0x30 | (m.retain ? 1 : 0), Buffer.concat([str(m.topic), enc(m.payload)]));
}

export function encodeSubscribe(id: number, topics: readonly string[]): Buffer {
  return packet(
    0x82,
    Buffer.concat([u16(id), ...topics.map((t) => Buffer.concat([str(t), Buffer.from([0])]))]),
  );
}

export const encodePingReq = (): Buffer => Buffer.from([0xc0, 0]);
export const encodeDisconnect = (): Buffer => Buffer.from([0xe0, 0]);

export type Packet =
  | { readonly type: "connack"; readonly returnCode: number }
  | { readonly type: "suback" }
  | { readonly type: "pingresp" }
  | { readonly type: "publish"; readonly topic: string; readonly payload: string }
  | { readonly type: "other" };

/** Splits a byte stream into packets; keeps a partial packet until the rest arrives. */
export class PacketParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Packet[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Packet[] = [];
    for (;;) {
      let len = 0;
      let mult = 1;
      let i = 1;
      let complete = false;
      while (i < this.buf.length && i <= 4) {
        const d = this.buf[i] ?? 0;
        len += (d & 0x7f) * mult;
        mult *= 128;
        i += 1;
        if ((d & 0x80) === 0) {
          complete = true;
          break;
        }
      }
      if (!complete || this.buf.length < i + len) return out;
      const first = this.buf[0] ?? 0;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      out.push(decode(first, body));
    }
  }
}

function decode(first: number, body: Buffer): Packet {
  switch (first >> 4) {
    case 2:
      return { type: "connack", returnCode: body[1] ?? 0xff };
    case 9:
      return { type: "suback" };
    case 13:
      return { type: "pingresp" };
    case 3: {
      const topicLen = body.readUInt16BE(0);
      const topic = body.toString("utf8", 2, 2 + topicLen);
      const qos = (first >> 1) & 3;
      const start = 2 + topicLen + (qos > 0 ? 2 : 0);
      return { type: "publish", topic, payload: body.toString("utf8", start) };
    }
    default:
      return { type: "other" };
  }
}

/** One connection to the broker, however it is opened. */
export interface Wire {
  write(bytes: Uint8Array): void;
  end(): void;
  /** Called once, right after opening. */
  listen(onData: (bytes: Uint8Array) => void, onClose: () => void): void;
}

export interface MqttOptions {
  readonly open: () => Wire;
  readonly clientId: string;
  readonly username?: string;
  readonly password?: string;
  /** Published by the broker if the bridge disappears; HA then shows the entities as unavailable. */
  readonly will?: Will;
  readonly keepAliveSeconds?: number;
  /** Runs `fn` after `ms`; returns a cancel function. Injected so tests control time. */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

const RECONNECT_MS = 5000;

const realSchedule = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref(); // timers alone never keep the process alive; the socket does
  return () => {
    clearTimeout(t);
  };
};

export class MqttTransport implements HaTransport {
  private readonly o: MqttOptions;
  private readonly keepAlive: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private wire: Wire | undefined;
  private connecting: Promise<void> | undefined;
  private connected = false;
  private closed = false;
  private cancelPing: (() => void) | undefined;
  private nextId = 1;
  private readonly subs: { topics: readonly string[]; handler: (t: string, p: string) => void }[] =
    [];

  constructor(options: MqttOptions) {
    this.o = options;
    this.keepAlive = options.keepAliveSeconds ?? 60;
    this.schedule = options.schedule ?? realSchedule;
  }

  private connect(): Promise<void> {
    this.connecting ??= new Promise<void>((resolve, reject) => {
      const wire = this.o.open();
      const parser = new PacketParser();
      this.wire = wire;
      wire.listen(
        (bytes) => {
          for (const p of parser.push(bytes)) {
            if (p.type === "connack") {
              if (p.returnCode === 0) {
                this.connected = true;
                this.resubscribe();
                this.armPing();
                resolve();
              } else {
                reject(new Error(`MQTT connection refused (code ${String(p.returnCode)})`));
              }
            } else if (p.type === "publish") {
              this.dispatch(p.topic, p.payload);
            }
          }
        },
        () => {
          this.onClosed(reject);
        },
      );
      wire.write(
        encodeConnect({
          clientId: this.o.clientId,
          keepAliveSeconds: this.keepAlive,
          ...(this.o.username === undefined ? {} : { username: this.o.username }),
          ...(this.o.password === undefined ? {} : { password: this.o.password }),
          ...(this.o.will === undefined ? {} : { will: this.o.will }),
        }),
      );
    });
    return this.connecting;
  }

  private onClosed(reject: (e: Error) => void): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.connecting = undefined;
    this.wire = undefined;
    this.cancelPing?.();
    reject(new Error("MQTT connection closed"));
    if (!this.closed && wasConnected && this.subs.length > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.schedule(() => {
      if (this.closed) return;
      this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, RECONNECT_MS);
  }

  private armPing(): void {
    this.cancelPing?.();
    this.cancelPing = this.schedule(
      () => {
        this.wire?.write(encodePingReq());
        this.armPing();
      },
      (this.keepAlive * 1000) / 2,
    );
  }

  private resubscribe(): void {
    const topics = this.subs.flatMap((s) => s.topics);
    if (topics.length > 0) this.wire?.write(encodeSubscribe(this.nextId++, topics));
  }

  private dispatch(topic: string, payload: string): void {
    for (const s of this.subs) if (s.topics.includes(topic)) s.handler(topic, payload);
  }

  async publish(m: Msg): Promise<void> {
    await this.connect();
    this.wire?.write(encodePublish(m));
  }

  async subscribe(
    topics: readonly string[],
    onMessage: (topic: string, payload: string) => void,
  ): Promise<void> {
    this.subs.push({ topics, handler: onMessage });
    if (this.connected) {
      this.wire?.write(encodeSubscribe(this.nextId++, topics));
      return;
    }
    await this.connect(); // the CONNACK handler sends the SUBSCRIBE
  }

  close(): Promise<void> {
    this.closed = true;
    this.cancelPing?.();
    this.wire?.write(encodeDisconnect());
    this.wire?.end();
    this.connected = false;
    return Promise.resolve();
  }
}
