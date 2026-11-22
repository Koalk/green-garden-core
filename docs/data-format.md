<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Data format and version rule

The export file (`format: "green-garden-export"`) is the one shape of a garden everywhere: the file
Export/Import, the browser store, the server's space files and the Stories app's saved state. The code
is `packages/storage/src/exchange.ts`; the current version is `VERSION` there.

## The version rule

1. **Every added key bumps the version.** A new key on the file, on `settings`, or on a plant, room or log
   entry is a format change even when it is optional. Two builds that both say "version 8" must agree
   about what a plant is. Bump `VERSION`, add a step to `STEPS` in `packages/storage/src/migrate.ts` if old
   files need the new key filled in, and write the vector first (red/green).
2. **A reader that sees a higher version may read, but asks before overwriting.** Import reads what it
   knows and carries the rest through (rule 3). `BrowserStore` copies the stored text to
   `<key>.backup-<timestamp>` on load and refuses `save()` until `confirmOverwrite()` is called, after the
   user has been told. The server refuses a PUT whose version is lower than the stored one (HTTP 422).
3. **Import never loses data.** Keys this build does not understand are carried and written back on
   export: at the top level, on `settings`, on each plant, room and log entry. Known fields stay
   validated (a bad value is dropped with a warning, as before). The Stories app's `stories` section
   survives a core round trip this way.
4. **A store load never drops a plant.** `importData(text, { keepInvalid: true })` keeps a plant that
   fails validation (an unknown watering style, a missing interval), with all its original keys and an
   `invalid: [codes]` mark. The plan leaves it out; `invalidPlants(data)` lists it so the UI can show it as
   "needs attention" with what is wrong. A build that can read it later drops the mark by itself. A
   **file** import (no option) may still refuse such a plant, with the warning shown.
5. **The server stores the body it was sent** once the format check passes (not a re-serialised copy), so
   keys it does not know survive there too.

## Loading a store is not importing a file

A file import is the user choosing to bring data in, so refusing a bad entry with a warning is fine. A
store load runs on every start and is followed by a save, so anything dropped on load is lost for good.
On a fatal problem (unparseable text, wrong format, higher version) the old text is backed up first and
`store.lastLoad` carries the issues and the backup key for the UI to tell the user. Saves can fail
(quota, storage error) and throw; the caller reports it.

## Versions

| Version | Added |
|---|---|
| 11 | Groundwork for sharing a garden between people and devices (nothing shares yet). Top-level `sync` (this device's ID, its latest stamp and, once a household exists, the household's ID and key, its `members`, `me`, the last stamp `seen` from each member and `tombstones`). Plants and rooms carry `stamps` (when each field last changed) and an optional `deleted`; plants may carry a `checkpoint` (`cutoff` day and `seed`). Log entries carry `id`, `by` and `at`. Spaces carry `awayStamps` and `awayTombstones` for away days. A version 10 file migrates on import: see below. |
| 10 | `seasonal` on the file: the seasonal cards' "Not yet" and "Leave it out" choices per plant (`snoozedUntil`, `leftOutUntil`), so they survive a reload and travel in the export. Also what a plant's room carries: an indoor plant without its own `directSun` takes its room's. A version 9 file imports unchanged; no migration step is needed (the key is optional). |
| 9 | Declared for `addedOn`, `placementHistory` and `directSun`, which arrived while the number still said 8. Migration from 8: a plant without `addedOn` gets the earliest day its history shows, marked estimated. |
| 8 and older | Earlier versions are not documented here. |

## Sharing groundwork (version 11)

Changes to a garden that more than one person or device makes need an order and an identity. Version 11 adds
both to the file; no code here sends or merges anything yet.

- **Stamps.** A stamp is a hybrid logical clock value: wall time in milliseconds, a counter for changes in the
  same millisecond, and the ID of the device that made the change. The later stamp wins; the device ID
  breaks an exact tie. A device's stamps never go backwards, even if its clock does. In JSON a stamp is a
  fixed-width string (`<12 hex>-<4 hex>-<16 hex>`), so sorting the strings sorts the stamps. `"0"` is
  older than any real stamp.
- **IDs.** New plants, rooms, households, devices and log entries get 8 random bytes written as 16 hex
  digits. IDs that already exist stay as they are (a plant called `p1` keeps working). Where an old record
  needs a shared ID (log entries from before version 11), the ID is a fixed hash of what identifies it, so
  two devices that import the same file work out the same ID.
- **Fields.** `stamps` maps a field name to the stamp of its last change. A field without a stamp counts as
  stamp 0. `deleted: true` keeps a removed plant or room in the file so the removal can be shared;
  `stamps.deleted` says when. Away days are one list per space, so `awayStamps` holds a stamp per day and
  `awayTombstones` the days that were removed.
- **Log entries.** `id` tells two entries apart, `by` is the index (0 to 31) of the member who made it and
  `at` is the stamp of when. `by` is absent on entries from before version 11.
- **Checkpoints.** `checkpoint: { cutoff, seed }` on a plant records its state as of a cutoff day so older
  log entries can be dropped. It is read and written back; nothing creates one yet.
- **`sync` block.** `device` and `stamp` exist on every device. The household fields appear only once the
  device belongs to a household. The `inbox` of changes waiting to be applied is device-only and never
  exported.
- **Household and personal keys.** The export keeps one complete layout. `HOUSEHOLD_*` and `PERSONAL_*`
  lists in `packages/storage/src/sync/keys.ts` say which keys belong to the whole household (plants, rooms,
  pins, seasonal choices, away days, hemisphere, latitude, country, climate, winter minimum, household,
  weather, calibration, watering days) and which to one member (language, units, week start, horizon,
  reminders, questions, question pacing, drafts and the app's own `stories` section).

### Migrating a version 10 file

- Every field present gets stamp 0, so any real edit wins over it. Placement history and log entries are
  events and carry no field stamps.
- Every log entry gets an ID derived from (plant ID, date, outcome, position in the plant's log) and
  `at: "0"`, and no `by`.
- Each away day gets stamp 0.
- A device ID is minted the first time a file is loaded, with stamp 0, and kept after that.
- The plan the engine makes from the data is unchanged: it does not read any of the new fields.
- Stamps for fields that gain a value after loading are the caller's job; the migration only fills stamps
  that are missing from files older than version 11.

## Export and import in general

- One versioned JSON document holds plants, rooms, care settings, the watering log and unavailable dates.
- Export from any client imports into any other. Contract tests cover round trips: export, import into
  the other adapter, export again, compare.
- Export and import are the backup and migration path. Sharing between devices builds on the fields in version 11 below.