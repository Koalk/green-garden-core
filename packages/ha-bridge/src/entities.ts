// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure core of the Home Assistant bridge (D-28): the plan of one space becomes MQTT discovery
 * and state messages. Per plant a "needs water today" binary sensor, a next-watering date sensor and
 * two buttons ("watered", "still wet"); per home a due count and a text list. No clock, no network.
 */
import {
  makePlan,
  spaceView,
  activeSpaceId,
  type AppData,
  type Plant,
} from "@green-garden/storage";

export interface BridgeConfig {
  /** The dataset on the server; part of every topic so two spaces never collide. */
  readonly space: string;
  /** HA's MQTT discovery prefix; `homeassistant` unless HA was changed. */
  readonly discoveryPrefix: string;
  /** The space inside the data to publish; the first one by default. */
  readonly spaceId?: string;
}

export interface Msg {
  readonly topic: string;
  readonly payload: string;
  readonly retain: boolean;
}

export type ButtonAction = "watered" | "still_wet";

export interface Snapshot {
  readonly discovery: readonly Msg[];
  readonly states: readonly Msg[];
  /** Button topic to what pressing it means. */
  readonly commands: ReadonlyMap<
    string,
    { readonly plantId: string; readonly action: ButtonAction }
  >;
}

export const ACTIONS: readonly ButtonAction[] = ["watered", "still_wet"];

/** Lower-case letters, digits and underscores only: safe in an MQTT topic and an HA entity id. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+(?=.)/, "");
}

export function baseTopic(space: string): string {
  return `green-garden/${slug(space)}`;
}

export function statusTopic(space: string): string {
  return `${baseTopic(space)}/status`;
}

/** Outcomes that close a plant for the rest of today; dry early keeps it due (same as the UI). */
const CLOSES_TODAY = new Set(["done", "skipped", "still_wet"]);

function handledToday(p: Plant, today: string): boolean {
  return (p.logs ?? []).some((l) => l.date === today && CLOSES_TODAY.has(l.outcome));
}

const msg = (topic: string, payload: string): Msg => ({ topic, payload, retain: true });

export function buildSnapshot(data: AppData, today: string, cfg: BridgeConfig): Snapshot {
  const spaceId = cfg.spaceId ?? activeSpaceId(data);
  const view = spaceView(data, spaceId);
  const plan = makePlan(data, today, spaceId);
  const base = baseTopic(cfg.space);
  const avail = statusTopic(cfg.space);
  const dueToday = new Set(plan.days.find((d) => d.date === today)?.plantIds ?? []);
  const discovery: Msg[] = [];
  const states: Msg[] = [];
  const commands = new Map<string, { plantId: string; action: ButtonAction }>();
  const due: string[] = [];

  for (const p of [...view.plants].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const key = slug(p.id);
    const node = `gg_${slug(cfg.space)}_${key}`;
    const device = { identifiers: [node], name: p.name, manufacturer: "Green Garden" };
    const common = { availability_topic: avail, device };
    const needs = dueToday.has(p.id) && !handledToday(p, today);
    if (needs) due.push(p.name);

    discovery.push(
      msg(
        `${cfg.discoveryPrefix}/binary_sensor/${node}/needs_water/config`,
        JSON.stringify({
          ...common,
          name: `${p.name} needs water`,
          unique_id: `${node}_needs_water`,
          state_topic: `${base}/${key}/needs_water`,
          payload_on: "ON",
          payload_off: "OFF",
        }),
      ),
      msg(
        `${cfg.discoveryPrefix}/sensor/${node}/next_watering/config`,
        JSON.stringify({
          ...common,
          name: `${p.name} next watering`,
          unique_id: `${node}_next_watering`,
          state_topic: `${base}/${key}/next_watering`,
          device_class: "date",
        }),
      ),
    );
    const labels: Record<ButtonAction, string> = { watered: "watered", still_wet: "still wet" };
    for (const action of ACTIONS) {
      const topic = `${base}/${key}/${action}/press`;
      commands.set(topic, { plantId: p.id, action });
      discovery.push(
        msg(
          `${cfg.discoveryPrefix}/button/${node}/${action}/config`,
          JSON.stringify({
            ...common,
            name: `${p.name} ${labels[action]}`,
            unique_id: `${node}_${action}`,
            command_topic: topic,
            payload_press: "PRESS",
          }),
        ),
      );
    }

    const next = plan.plants
      .find((pp) => pp.plantId === p.id)
      ?.waterings.find((w) => w.date > today || (w.date === today && !handledToday(p, today)));
    states.push(
      msg(`${base}/${key}/needs_water`, needs ? "ON" : "OFF"),
      msg(`${base}/${key}/next_watering`, next?.date ?? "unknown"),
    );
  }

  const home = {
    identifiers: [`gg_${slug(cfg.space)}`],
    name: "Green Garden",
    manufacturer: "Green Garden",
  };
  for (const [object, name, extra] of [
    ["due_count", "Plants due today", { state_class: "measurement" }],
    ["due_list", "Plants due today (list)", {}],
  ] as const) {
    discovery.push(
      msg(
        `${cfg.discoveryPrefix}/sensor/gg_${slug(cfg.space)}/${object}/config`,
        JSON.stringify({
          availability_topic: avail,
          device: home,
          name,
          unique_id: `gg_${slug(cfg.space)}_${object}`,
          state_topic: `${base}/${object}`,
          ...extra,
        }),
      ),
    );
  }
  states.push(
    msg(`${base}/due_count`, String(due.length)),
    msg(`${base}/due_list`, due.length === 0 ? "Nothing" : due.join(", ")),
  );
  return { discovery, states, commands };
}
