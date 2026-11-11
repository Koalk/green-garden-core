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
| 9 | Declared for `addedOn`, `placementHistory` and `directSun`, which arrived while the number still said 8. Migration from 8: a plant without `addedOn` gets the earliest day its history shows, marked estimated. |
| 8 and older | Earlier versions are not documented here. |

## Export and import in general

- One versioned JSON document holds plants, rooms, care settings, the watering log and unavailable dates.
- Export from any client imports into any other. Contract tests cover round trips: export, import into
  the other adapter, export again, compare.
- Sync is out of scope; export and import are the backup and migration path.