// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The impure shell around the entities: reads the plan from the core server through the `Backend`
 * seam, publishes it through an `HaTransport`, and turns a button press into a log entry. Backend,
 * transport and clock are injected, so tests run against fakes and never touch a network.
 *
 * A press is a log, nothing more: the server's reminder stop rule (D-08) counts unactioned reminders
 * and any log resumes them, so a tap on the display resumes a plant exactly as a tap in the app does.
 */
import type { Backend } from "@green-garden/client";
import type { LogOutcome } from "@green-garden/engine";
import { logOutcome, type AppData } from "@green-garden/storage";
import {
  buildSnapshot,
  statusTopic,
  type BridgeConfig,
  type ButtonAction,
  type Msg,
} from "./entities.ts";

/** What the bridge needs from MQTT (or any other way into HA). */
export interface HaTransport {
  publish(m: Msg): Promise<void>;
  /** Calls `onMessage` for every message on these topics, also after a reconnect. */
  subscribe(
    topics: readonly string[],
    onMessage: (topic: string, payload: string) => void,
  ): Promise<void>;
}

export type PressResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "ignored" | "conflict" | "unreachable" | "unauthorised" | "invalid";
    };

export interface BridgeOptions {
  readonly backend: Backend;
  readonly transport: HaTransport;
  readonly config: BridgeConfig;
  readonly now: () => Date;
  /** Where problems go; defaults to nowhere. */
  readonly log?: (line: string) => void;
}

const OUTCOME: Record<ButtonAction, LogOutcome> = { watered: "done", still_wet: "still_wet" };

/** Local calendar date: watering days are days on the wall, not UTC days. */
function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class Bridge {
  private readonly o: BridgeOptions;
  private commands: ReadonlyMap<string, { plantId: string; action: ButtonAction }> = new Map();
  private published = new Set<string>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: BridgeOptions) {
    this.o = options;
  }

  private log(line: string): void {
    this.o.log?.(line);
  }

  private async publishData(data: AppData): Promise<void> {
    const snap = buildSnapshot(data, localDate(this.o.now()), this.o.config);
    const now = new Set(snap.discovery.map((m) => m.topic));
    // Published before, gone now (plant deleted): an empty retained payload removes the entity in HA.
    const removals = [...this.published]
      .filter((t) => !now.has(t))
      .map((topic) => ({ topic, payload: "", retain: true }));
    for (const m of [...snap.discovery, ...removals, ...snap.states]) {
      await this.o.transport.publish(m);
    }
    await this.o.transport.publish({
      topic: statusTopic(this.o.config.space),
      payload: "online",
      retain: true,
    });
    this.published = now;
    this.commands = snap.commands;
  }

  /** Reads the plan and publishes everything. Returns false when the server could not be read. */
  async sync(): Promise<boolean> {
    const r = await this.o.backend.load();
    if (!r.ok) {
      this.log(`sync: server ${r.reason}`);
      return false;
    }
    await this.publishData(r.data);
    return true;
  }

  /** Publishes, then listens for button presses. */
  async start(): Promise<void> {
    await this.sync();
    await this.o.transport.subscribe([...this.commands.keys()], (topic, payload) => {
      this.pending = this.pending
        .then(() => this.press(topic, payload))
        .catch((e: unknown) => {
          this.log(`press failed: ${String(e)}`);
        });
    });
  }

  /** Resolves when the presses received so far are handled (tests, shutdown). */
  async idle(): Promise<void> {
    await this.pending;
  }

  async stop(): Promise<void> {
    await this.o.transport.publish({
      topic: statusTopic(this.o.config.space),
      payload: "offline",
      retain: true,
    });
  }

  /** One button press: log it in the server (optimistic revision, one retry on conflict), then republish. */
  async press(topic: string, payload: string): Promise<PressResult> {
    const cmd = this.commands.get(topic);
    if (cmd === undefined || payload !== "PRESS") return { ok: false, reason: "ignored" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await this.o.backend.load();
      if (!r.ok) return { ok: false, reason: r.reason };
      const next = logOutcome(r.data, cmd.plantId, OUTCOME[cmd.action], localDate(this.o.now()));
      const saved = await this.o.backend.save(next, r.revision);
      if (saved.ok) {
        await this.publishData(next);
        return { ok: true };
      }
      if (saved.reason !== "conflict") return { ok: false, reason: saved.reason };
    }
    this.log(`press on ${topic}: conflict twice, not logged`);
    return { ok: false, reason: "conflict" };
  }
}
