# ADR 0003: Home Assistant bridge transport

- Status: Accepted
- Date: 2026-10-29

## Context

Smart displays (Nest Hub and similar) and voice go through Home Assistant (HA). The bridge in
`packages/ha-bridge` shows each plant in HA as a "needs water today" binary sensor, a next-watering
date sensor and two buttons ("watered", "still wet"), plus a due count and a text list for the whole
home. A press on a button must reach the core server as a log entry.

Two ways into HA were on the table:

1. **MQTT discovery.** The bridge publishes retained config messages and states to a broker; HA creates
   real entities from them. Buttons are MQTT `button` entities whose command topic the bridge listens on.
2. **HA REST/WebSocket API with a long-lived token.** No broker, but entities created by
   `POST /api/states` are not backed by an integration: they vanish on an HA restart until re-posted,
   cannot be pressed (a button needs an integration behind it), and have no `unique_id`, so they cannot
   be assigned to areas or exposed to Google or Alexa from the UI.

## Decision

MQTT discovery, behind the `HaTransport` interface (`publish`, `subscribe`), so the REST/WebSocket
variant or a HACS integration can be added later without touching the bridge.

Reasons:

- Entities are real: they have unique ids, survive HA restarts (retained config), can be placed in
  areas and exposed to Google Assistant and Alexa through HA's own links. That is the voice path
  asks for, and it only works for entities with unique ids.
- A button needs a command channel; MQTT has one built in, the REST API does not.
- Availability comes free: the broker publishes the last will `offline` if the bridge dies, and HA
  greys the entities out.
- The cost is a broker. Most HA installs already run one (the Mosquitto add-on); someone without one
  adds it in a few clicks. That is the price of the setup, and it is documented.

## The client

The MQTT client is written in the repo (`packages/ha-bridge/src/mqtt.ts`, about 250 lines), QoS 0 only:
CONNECT with optional credentials and a retained last will, PUBLISH, SUBSCRIBE, PINGREQ, DISCONNECT, a
byte-exact packet codec and reconnect with re-subscribe. This follows the server's SMTP client: no
runtime dependency, nothing to add to `THIRD_PARTY.md`, and the no-network gate stays simple because
tests drive a fake `Wire`. QoS 0 is enough because every state is retained and the bridge re-publishes
everything every few minutes, so a lost message heals itself.

Alternative: the `mqtt` package (MIT). It is mature and covers QoS 1 and 2, TLS options and WebSocket
transport, but brings a dependency tree that every licence check must cover. Revisit if QoS 1 or a
websocket broker connection is ever needed.

## Consequences

- Needs a broker and credentials; the bridge never talks to HA's API, so it needs no HA token.
- Entities of a plant deleted while the bridge is down stay in HA until removed by hand: the bridge only
  knows what it published itself since it started. A retained index topic would fix this; not built.
- Untried against a real HA and broker (the sandbox has neither): the wire format is checked byte for
  byte against the MQTT 3.1.1 spec, the discovery payloads against HA's documented schema.
