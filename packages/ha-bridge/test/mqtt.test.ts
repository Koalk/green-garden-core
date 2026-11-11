// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MqttTransport,
  PacketParser,
  encodeConnect,
  encodeDisconnect,
  encodePingReq,
  encodePublish,
  encodeSubscribe,
  type Wire,
} from "../src/index.ts";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));

describe("MQTT 3.1.1 packets, byte-exact", () => {
  it("CONNECT with clean session and keep-alive", () => {
    // 10 | len 0x11 | 0004 "MQTT" | level 4 | flags 02 | keepalive 003c | id "gg" (0002 6767)
    assert.equal(
      hex(encodeConnect({ clientId: "gg", keepAliveSeconds: 60 })),
      "100e0004" + "4d515454" + "04" + "02" + "003c" + "00026767",
    );
  });

  it("CONNECT with credentials and a retained last will", () => {
    const p = encodeConnect({
      clientId: "gg",
      keepAliveSeconds: 60,
      username: "u",
      password: "p",
      will: { topic: "s", payload: "offline", retain: true },
    });
    // flags: username 80 + password 40 + will retain 20 + will 04 + clean 02 = e6
    assert.equal(hex(p.subarray(0, 10)), "10" + "20" + "0004" + "4d515454" + "04" + "e6");
    assert.equal(
      hex(p.subarray(10)),
      "003c" +
        "00026767" +
        "0001" +
        "73" +
        "0007" +
        Buffer.from("offline").toString("hex") +
        "0001" +
        "75" +
        "0001" +
        "70",
    );
  });

  it("PUBLISH QoS 0, with and without retain", () => {
    assert.equal(
      hex(encodePublish({ topic: "a/b", payload: "hi", retain: false })),
      "30" + "07" + "0003" + "612f62" + "6869",
    );
    assert.equal(
      hex(encodePublish({ topic: "a/b", payload: "hi", retain: true })),
      "31" + "07" + "0003" + "612f62" + "6869",
    );
  });

  it("PUBLISH with an empty payload (removes a retained message)", () => {
    assert.equal(
      hex(encodePublish({ topic: "t", payload: "", retain: true })),
      "31" + "03" + "0001" + "74",
    );
  });

  it("remaining length uses the variable-length encoding above 127 bytes", () => {
    const p = encodePublish({ topic: "t", payload: "x".repeat(200), retain: false });
    // 2 + 1 + 200 = 203 -> 0xCB 0x01
    assert.equal(hex(p.subarray(0, 3)), "30cb01");
    assert.equal(p.length, 3 + 203);
  });

  it("SUBSCRIBE, PINGREQ, DISCONNECT", () => {
    assert.equal(hex(encodeSubscribe(1, ["a/#"])), "82" + "08" + "0001" + "0003" + "612f23" + "00");
    assert.equal(hex(encodePingReq()), "c000");
    assert.equal(hex(encodeDisconnect()), "e000");
  });

  it("the parser reads CONNACK, SUBACK, PINGRESP and PUBLISH, also split across chunks", () => {
    const parser = new PacketParser();
    const all = "20020000" + "9003000100" + "d000" + "30070003612f626869";
    const got = [
      ...parser.push(bytes(all.slice(0, 6))),
      ...parser.push(bytes(all.slice(6, 24))),
      ...parser.push(bytes(all.slice(24))),
    ];
    assert.deepEqual(
      got.map((p) => p.type),
      ["connack", "suback", "pingresp", "publish"],
    );
    const pub = got[3];
    assert.equal(pub?.type === "publish" && pub.topic, "a/b");
    assert.equal(pub?.type === "publish" && pub.payload, "hi");
    const ack = got[0];
    assert.equal(ack?.type === "connack" && ack.returnCode, 0);
  });

  it("parses a long PUBLISH (two-byte remaining length)", () => {
    const parser = new PacketParser();
    const [p] = parser.push(encodePublish({ topic: "t", payload: "y".repeat(300), retain: true }));
    assert.equal(p?.type === "publish" && p.payload.length, 300);
  });
});

/** A scripted broker connection: records what is written, lets the test push bytes back. */
class FakeWire implements Wire {
  written: Uint8Array[] = [];
  ended = false;
  private onData: (b: Uint8Array) => void = () => undefined;
  private onClose: () => void = () => undefined;
  write(b: Uint8Array): void {
    this.written.push(b);
  }
  end(): void {
    this.ended = true;
  }
  listen(onData: (b: Uint8Array) => void, onClose: () => void): void {
    this.onData = onData;
    this.onClose = onClose;
  }
  receive(h: string): void {
    this.onData(bytes(h));
  }
  drop(): void {
    this.onClose();
  }
  types(): string[] {
    return this.written.map((w) => hex(w).slice(0, 2));
  }
}

describe("MQTT transport", () => {
  it("connects, waits for CONNACK, then publishes", async () => {
    const wire = new FakeWire();
    const t = new MqttTransport({
      open: () => wire,
      clientId: "gg",
      will: { topic: "s", payload: "offline", retain: true },
    });
    const done = t.publish({ topic: "a", payload: "1", retain: true });
    assert.deepEqual(wire.types(), ["10"]);
    wire.receive("20020000");
    await done;
    assert.deepEqual(wire.types(), ["10", "31"]);
  });

  it("a refused connection rejects the publish", async () => {
    const wire = new FakeWire();
    const t = new MqttTransport({ open: () => wire, clientId: "gg" });
    const done = t.publish({ topic: "a", payload: "1", retain: true });
    wire.receive("20020005"); // not authorised
    await assert.rejects(done, /refused/);
  });

  it("subscribes after CONNACK and delivers incoming messages", async () => {
    const wire = new FakeWire();
    const t = new MqttTransport({ open: () => wire, clientId: "gg" });
    const got: string[] = [];
    const sub = t.subscribe(["a/b"], (topic, payload) => got.push(`${topic}=${payload}`));
    wire.receive("20020000");
    await sub;
    assert.equal(wire.types().at(-1), "82");
    wire.receive("30070003612f626869");
    assert.deepEqual(got, ["a/b=hi"]);
  });

  it("reconnects after the connection drops and subscribes again", async () => {
    const wires: FakeWire[] = [];
    const timers: (() => void)[] = [];
    const t = new MqttTransport({
      open: () => {
        const w = new FakeWire();
        wires.push(w);
        return w;
      },
      clientId: "gg",
      schedule: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    const sub = t.subscribe(["a/b"], () => undefined);
    wires[0]?.receive("20020000");
    await sub;
    wires[0]?.drop();
    timers.at(-1)?.();
    assert.equal(wires.length, 2);
    wires[1]?.receive("20020000");
    assert.deepEqual(wires[1]?.types(), ["10", "82"]);
  });

  it("sends a ping on the keep-alive timer and a clean DISCONNECT on close", async () => {
    const wire = new FakeWire();
    const pings: (() => void)[] = [];
    const t = new MqttTransport({
      open: () => wire,
      clientId: "gg",
      schedule: (fn) => {
        pings.push(fn);
        return () => undefined;
      },
    });
    const done = t.publish({ topic: "a", payload: "1", retain: false });
    wire.receive("20020000");
    await done;
    pings.at(-1)?.();
    assert.equal(wire.types().at(-1), "c0");
    await t.close();
    assert.equal(wire.types().at(-1), "e0");
    assert.ok(wire.ended);
  });
});
