# Home Assistant: plants on a wall display

> **Status: untried against a real Home Assistant.** Everything below was built and tested against
> in-process fakes and the MQTT 3.1.1 and HA discovery documentation. Each step that has not been run
> on a real HA says so. Report what differs.

With Home Assistant (HA) you can see today's plants on a wall display and tap "Watered", or say it to
Google or Alexa through HA. The core server holds the data; the bridge (`packages/ha-bridge`) is a small
Node service next to it that publishes the plants to HA over MQTT and turns a button press into a log
entry. Why MQTT: [ADR 0003](adr/0003-home-assistant-transport.md).

```
phone / web app <-> core server <-> ha-bridge <-> MQTT broker <-> Home Assistant -> display, voice
```

## What you need

- The core server running (`mise run server`, see the README) with some plants in it.
- An MQTT broker HA uses. In HA: Settings, Devices & services, add the **MQTT** integration; if you
  have no broker, install the **Mosquitto broker** add-on first. _Untried._
- A broker login for the bridge (in HA: Settings, People, add a user; the Mosquitto add-on accepts HA
  users). _Untried._

## Set up the bridge

Add to `.env` (never commit it; `.env.example` lists the keys, empty):

```
GREEN_GARDEN_SERVER_TOKEN=...               # the server's token, same as for the server
GREEN_GARDEN_SERVER_URL=http://localhost:8080
GREEN_GARDEN_HA_MQTT_URL=mqtt://192.168.1.5:1883    # mqtts:// for TLS
GREEN_GARDEN_HA_MQTT_USER=...
GREEN_GARDEN_HA_MQTT_PASSWORD=...
GREEN_GARDEN_HA_SPACE=default               # which dataset on the server (default "default")
GREEN_GARDEN_HA_SYNC_SECONDS=300            # how often to re-read the plan (default 300)
```

Then `mise run ha-bridge` (from the workspace root: `mise run core-ha-bridge`). It prints
`Green Garden HA bridge up` once it has published. Leave it running next to the server. _Untried._

## What shows up in HA

One **device per plant**, named after the plant, with four entities:

| Entity                              | Meaning                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `binary_sensor.<plant>_needs_water` | on while the plant is due today and not yet watered, skipped or marked still wet |
| `sensor.<plant>_next_watering`      | the next planned watering date (a date sensor)                                   |
| `button.<plant>_watered`            | logs "done" for today in the server                                              |
| `button.<plant>_still_wet`          | logs "still wet" for today (closes the plant for today)                          |

One **Green Garden** device for the whole home:

- `sensor.plants_due_today`: how many plants are due today.
- `sensor.plants_due_today_list`: their names, comma separated ("Nothing" when none).

Entity ids follow HA's naming from the device and entity names; yours may differ slightly. The bridge
re-reads the server every few minutes and right after each button press, so the display follows edits
made in the app. A press follows the same rules as the app: it is logged on the server, the plan moves,
and reminders for that plant resume if they had stopped (the stop rule counts only unactioned
reminders). If another device saved at the same moment, the bridge retries once with the fresh data and
then gives up (it logs a line; press again). When the bridge stops, the broker marks everything
unavailable.

## Dashboard for a Nest Hub sized screen

Big tiles, one tap per plant, nothing else. Create a dashboard (Settings, Dashboards, add), open the raw
configuration editor and paste. Replace the entity ids with yours (Developer tools, States, filter by
`needs_water`). _Untried; the `tap_action` follows HA's documented tile card._

```yaml
title: Plants
views:
  - title: Today
    path: today
    type: panel
    cards:
      - type: vertical-stack
        cards:
          - type: tile
            entity: sensor.plants_due_today_list
            name: Water today
            icon: mdi:watering-can
            vertical: true
          - type: grid
            columns: 2
            square: false
            cards:
              - type: tile
                entity: binary_sensor.fern_needs_water
                name: Fern
                icon: mdi:flower
                vertical: true
                tap_action:
                  action: perform-action
                  perform_action: button.press
                  target:
                    entity_id: button.fern_watered
              - type: tile
                entity: binary_sensor.cactus_needs_water
                name: Cactus
                icon: mdi:cactus
                vertical: true
                tap_action:
                  action: perform-action
                  perform_action: button.press
                  target:
                    entity_id: button.cactus_watered
```

One tile per plant: the tile's colour shows whether it needs water (the binary sensor), a tap presses
"watered". Add a second tile with `button.<plant>_still_wet` only if you want that on the wall; most
people do not.

## Showing it on a Nest Hub

HA's Cast integration shows a dashboard on a Chromecast-capable screen with the
`cast.show_lovelace_view` action. As an automation or a script:

```yaml
action: cast.show_lovelace_view
data:
  entity_id: media_player.kitchen_display # your Nest Hub's cast entity
  dashboard_path: lovelace-plants # the dashboard's URL path
  view_path: today
```

The dashboard must be reachable by the Hub over HTTPS (Nabu Casa cloud or your own certificate);
casting a plain `http://` HA URL is refused by the Hub. The Hub is touch-capable, so the tiles work as
buttons. Call the script from a time-based automation (say 07:30) so the display shows the plants every
morning. _Untried._

## Voice through Google or Alexa

HA exposes the buttons to its voice assistants; the bridge does nothing extra.

1. Link HA to the assistant: the Google Assistant or Alexa integration in HA (Nabu Casa makes this one
   toggle; otherwise it is a cloud project you set up yourself). _Untried._
2. In HA, Settings, Voice assistants, Expose: expose `button.<plant>_watered` and
   `sensor.plants_due_today`. Give each button a clear name and put the plant in an area if you like.
3. Say it.

Example phrases (the exact wording depends on the assistant; buttons are usually treated as scenes or
"press" actions):

- Google: "Hey Google, activate Fern watered." Or make a Routine whose phrase is "I watered the fern"
  and whose action is "activate Fern watered".
- Alexa: "Alexa, turn on Fern watered." Or an Alexa Routine with the phrase "I watered the fern".
- HA's own Assist (Settings, Voice assistants) can use sentence triggers for the same thing.

Reading back what is due ("what do I water today?") needs a Routine or an Assist intent that reads
`sensor.plants_due_today_list`; the plain assistants do not read arbitrary sensors. _Untried._

## Known limits

- A plant deleted while the bridge was off leaves its entities in HA until you delete them there
  (ADR 0003, consequences).
- One server dataset ("space") per bridge; run a second bridge with another `GREEN_GARDEN_HA_SPACE`
  for a second one. Only the first space inside a dataset is offered.
- HA's own sensor readings (soil moisture and the like) are a separate, later feature.
