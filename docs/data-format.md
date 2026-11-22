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
## Merging two copies (`packages/storage/src/sync/merge.ts`)

`merge(local, incoming)` joins two copies of a version 11 document and returns the document, the
conflicts and the ID remaps. It is a pure function: no I/O, no clock. Merging the same copy twice gives
the same document, and so does merging copies in any order (the device's own `device` and `me` aside).
`mergeInbox(local, copies)` merges the copies with each other first and then once into `local`; the result
equals merging each in turn. A copy from another household is skipped (`ignored: "other-household"`).

- **Events are united.** Log entries are joined on their `id`. Placement moves are joined, an identical
  move kept once. A seasonal "not yet" or "leave it out" keeps the later day per plant. Away days are
  joined per space, each with its stamp; a removal (`awayTombstones`) wins over an add with an older stamp.
- **Undo is a tombstone** on the entry's `id` in `sync.tombstones` (the later stamp per key). The entry is
  removed and the tombstone keeps it from coming back.
- **Plant and room fields: the later stamp wins per field.** A tie on the stamp is broken by the device ID
  inside it; two values with the same stamp (for example both 0) go to the one whose canonical text sorts
  later, so both devices choose alike. Keys this build does not know are merged the same way. Settings are
  not merged yet: they carry no stamps, and the local copy's stay.
- **Replay state is not merged.** `lastWatered`, `anchor`, `adjustmentDays` and `doneStreak` are taken from
  the copy with the later last watering; replaying the entries from a checkpoint is what produces them.
- **Deletes keep the record.** `deleted` is a field like the others. A watering (outcome `done`) with a
  stamp later than the removal brings the plant back; otherwise it stays deleted with its entries kept.
  The result is the same in either order.
- **Checkpoints.** The later `cutoff` wins (equal cutoffs: the canonical text sorts later). Entries dated
  before the winning cutoff are dropped. Entries after it from both copies are united.
- **Old removals are dropped** when a `now` is passed: a tombstone, away-day removal or deleted record whose
  stamp is more than 180 days old goes once every member's last-seen stamp is past it. The cutoff
  (60 days) and the 180 days are in `sync/constants.ts`, provisional.
- **Conflicts.** A field is a conflict when both copies changed it since each last saw the other (the
  incoming stamp is after the local `seen` for the incoming member, and the local stamp is after the
  incoming copy's `seen` for the local member) and the values differ. The later stamp has already won; the
  loser is returned as `{ kind, id, field, mine, theirs }` with both stamps. Entries never conflict.
  `resolve(doc, conflict, "mine" | "theirs", now)` writes the chosen value back with a new stamp from this
  device, so it wins on every device.
- **`seen`.** After a merge, `sync.seen` holds for each member the latest stamp received from them, and
  for the local member its own first stamp, so the result does not depend on which copy was local. A copy
  from the same device does not count as a sender.
- **ID collisions.** A plant or room created apart on two devices with the same ID carries a creation stamp
  (`stamps.created`) and optionally its creator's member index (`createdBy`). The record with the lower
  (creator index, creation stamp) keeps the ID. The other gets a new ID worked out from the old one and its
  creation stamp (`derivedId`), so both devices choose the same one, and references to it (a plant's room,
  seasonal choices) follow. The remap is returned. A record without a creation stamp is never treated as a
  collision.
- **Order of lists.** Plants and rooms come out sorted by ID, spaces by ID, entries by date, then stamp,
  then ID.

## Replaying merged entries (`packages/engine`, `packages/storage/src/log.ts`)

The next watering date is worked out by replaying a plant's entries, so two people's entries can be
merged without either of them storing a date. The rules that matter once entries come from more than one
person:

- **One entry counts per day and outcome.** Two `done` entries for one plant on one day (two people
  watering it) move the schedule once, as if one had been logged; both stay in the entries, and each still
  counts as its member's watering. The same holds for any outcome except `rain`, whose entries are read
  as rainfall reports and are not reduced. Different outcomes on one day (a `done` and a `still_wet`) each
  count. For data from one person only, the replay differs from before in one case: two identical entries
  on one day.
- **Undo removes one entry.** `undoLog(data, plantId, entryId, stamp?)` removes only the entry with that
  `id`; another member's entry for the same day stands, so the schedule still moves once. With a `stamp`
  from the device's clock the removal is also kept as a tombstone, so merging with a copy that still holds
  the entry does not bring it back. Entries from before version 11 have no `id` and cannot be undone this
  way.
- **A checkpoint seeds the replay.** With `checkpoint: { cutoff, seed }`, entries and moves dated before
  `cutoff` (and weather rows before it) are ignored, and the replay starts from `seed`: `lastWatered`,
  `anchor`, `adjustmentDays`, `doneStreak` and `notBefore`, each optional. The seed replaces the plant's own
  fields of those names (a field it leaves out counts as unset), because it is the whole state as of the
  cutoff: the state after replaying everything dated before it. An entry dated on the cutoff day still
  counts. A checkpoint with an unreadable cutoff or seed value is ignored and reported as an issue. The
  replay uses a checkpoint for plants it schedules by interval.
- **Next-date check.** `nextDateChecks(data, today)` gives one small whole number (0 to 65535) per plant,
  worked out from the plant's ID, its replayed window (earliest and latest day) and the engine's
  `ENGINE_VERSION`. `checkNextDates(data, today, theirs)` compares another device's numbers with this
  device's and returns `{ kind: "engine-mismatch", plantId, mine, theirs }` for each plant both know whose
  numbers differ: two devices on different engines, or with different entries. It is data only; nothing
  blocks. `ENGINE_VERSION` goes up whenever a change to the replay would move a date for unchanged data.
