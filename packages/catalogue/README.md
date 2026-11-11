# @green-garden/catalogue

Catalogue schema checks (`validateCatalogue`, `stats`) and the plant name matcher. Pure TypeScript, no
dependencies, no network.

## Name matcher

Turns what a person typed into catalogue entries, for bulk add.

```ts
import { matchNames, createNameMatcher } from "@green-garden/catalogue";

const results = matchNames("2 pothos, big kitchen monstra\nlengua de suegra", catalogue, { locale: "es" });
// results[1] = { input, index: 1, verdict: "confident", count: 1,
//                candidates: [{ id: "monstera-deliciosa", score: 0.93, reason: "typo", matched, label }] }
```

- `matchNames(inputs, catalogue, { locale })`: `inputs` is one string or an array; each may hold several
  plants separated by commas, semicolons or new lines. One result per plant name, in order. Leading
  list markers (`-`, `1.`) and counts (`2 pothos`, `pothos x2`) are read and removed.
- `createNameMatcher(catalogue, { locale })`: the same, with the index built once (use it when matching
  repeatedly; `matchNames` caches per catalogue array and locale already).
- The catalogue is any list of `MatcherEntry`: `id`, `taxon.scientificName`, `names.common[{lang, name,
primary}]`, `names.synonyms`, `lookAlikes[{species}]`. A real catalogue entry fits as it is.

A result has a **verdict**:

| Verdict     | Meaning                                       | `candidates`                         |
| ----------- | --------------------------------------------- | ------------------------------------ |
| `confident` | preselect the first candidate                 | best first, up to 3 alternatives     |
| `choose`    | ask; 2 to 4 close ones (1 when it is weak)    | the close candidates, best first     |
| `none`      | nothing plausible; let the user retype        | empty                                |

Each candidate has `score` (0 to 1; compare within one input only), `reason`, the catalogue name that
`matched` (and its `lang`), and a `label` to show in the locale. Reasons: `exact` (scientific name or a
common name in the locale's language), `common` (a name in another language), `alias` (scientific
synonym), `typo`, `partial` ("snake" for "snake plant"), `genus`, `word-order`, `lookalike`. A result
that repeats an earlier plant has `duplicateOf` (the earlier result's index); it is flagged, never merged.

### Thresholds (`MATCH_THRESHOLDS`)

| Constant        | Value | Why                                                                                              |
| --------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `min`           | 0.5   | below this a candidate is noise (one unknown extra word on a half name falls here)               |
| `confident`     | 0.65  | a half name that covers 40% of a name, or a 3-edit typo, is still worth preselecting             |
| `margin`        | 0.2   | a rival within this of the best makes it `choose`; wide enough that an exact name still meets a 1-edit near miss of another plant (0.14 apart) as a `choose` |
| `maxCandidates` | 4     | what a person can compare at a glance                                                            |

Scores: exact 1.0; another language 0.97; synonym 0.95; words in another order 0.9; same letters with
other spacing ("snakeplant") 0.9; genus alone 0.85; typo 0.95 minus 0.09 per edit; partial 0.55 to 0.8
by how much of the name was typed. Edits allowed per word: none up to 3 letters, 1 up to 6, 2 up to 10,
3 beyond. Each input word with no partner costs a factor 0.75.

### Look-alikes and ambiguity

- Any match, however fully named, of a plant that has a look-alike entry in the catalogue is a
  `choose`, with the look-alikes added (reason `lookalike`): "pothos" asks, because of philodendron. Only plants with no look-alike entry come out `confident` on a full name.
  The list the person sees has the typed plant first, so one tap still confirms it.
- A bare genus ("sansevieria") goes to the entry named exactly that word if there is one. Entries that
  only start with it because one of their *synonyms* does ("Sansevieria cylindrica" on another plant)
  step aside; with no entry of that name the input is a `choose` between them.
- Look-alike links are read from `lookAlikes[].species` in both directions.
- A common name that is also another plant's genus ("geranium" for Pelargonium, and the genus Geranium)
  comes out as `choose` because the genus scores 0.85 and the margin is 0.2.

### Known limits

- "and", "y", "e" and "&" are not separators (no); "pothos and monstera" is read as one odd
  name and comes out as `choose`. Comma, semicolon and new line split.
- An extra word is assumed to be a descriptor or cultivar, so "calathea orbifolia" is a confident
  Calathea makoyana if that is the only Calathea in the catalogue.
- Look-alikes with no entry of their own (`lookAlikes` without `species`) cannot be offered.
- Names are matched in every language of the catalogue whatever the locale (see below). Until es and it
  names are in the catalogue, only scientific and English names can match.

### Names per language

A plant's names are `names.common`, a flat list of `{lang, name, primary?}`. The first (primary) item of a
language is its label; **every further item of that language is an alias** of it: the name on a shop label
in that country (es "geranio", it "geranio zonale"; en "cranesbill", "crane's-bill"). There is no separate
alias field.

- The matcher looks up every language, but a name in the user's locale scores `exact` (1.0) and one in
  another language `common` (0.97), so the user's own names come first. A word that names different plants
  in two languages is always a `choose` (the two scores are within the margin), the locale's plant first,
  never a silent pick.
- Validator: an item in a language other than en-GB needs `translation: {status: "machine"}`, a reviewed
  status with `reviewedBy`, or a `source` that is in the file's sources list (a shop label or a
  nursery page). en-GB aliases need nothing extra.
- Old entries are unchanged: they already are lists of items per language.
- For the runs: add the aliases people actually type in es and it as extra items of that language
  (docs: 01f, "Names per language").

Tests: `test/matcher.test.ts` runs a table of realistic inputs against the frozen
`test/fixture-catalogue.ts` (never edit it to follow the real catalogue), a speed test at 2000 entries,
and a smoke test on `catalogue-draft/`.

## Catalogue files and validation

A catalogue file is `{ schemaVersion, generatedOn, sources, entries }`; sources are listed once per
file and values refer to them by id. The bundled files live in `catalogue-draft/`, and
`validateCatalogue` (`src/validate.ts`) is the check.

Principles:

- **Every stored care value says where it came from and how sure we are:** `{ value, unit?, source,
  confidence }`. Confidence is `checked` (read in the cited source), `from_knowledge_verify`,
  `guess` or `unknown`; `user` is for values a person entered and never ships in the bundle. Only
  `checked` values are shown without a hedge.
- **Free to reuse.** Facts are stored in our own wording and grading; no copied text or datasets.
  Photos only under an allowed licence (CC0, CC BY, CC BY-SA, public domain), with creator, licence
  and source link per image.
- **Unknown is a value.** Missing data is `null` with `confidence: "unknown"`, never a default that
  looks like a fact. A plant with no toxicity data is `unknown`, never "safe".
- **Derived fields are computed, not stored:** pet and child reach, gloves, the pet-safe tag and tags
  taken from light and habit.
- Dates are `YYYY-MM-DD`; intervals in days, lengths in cm, temperatures in degrees Celsius.

An entry has `id` (stable slug), `taxon`, `names` (`common[{lang, name, primary?}]` and
`synonyms`), `care` (watering style, engine method, base interval, rest-season factor, dry and wet
tolerance, a watering tip, light, temperature, humidity, size, growth rate, habit, and the optional
in-ground fields), `toxicity` (status, agents, exposures by who and route with severity 0 to 3,
sources), `photos`, `tags` and `provenance`.

Validation (`pnpm check`):

1. Every value with a non-null `value` cites a source that exists in the file.
2. `checked` needs a source whose kind is not `author_knowledge`.
3. Photo licences are on the allow-list, with creator, licence URL and source URL present.
4. Ranges hold: `restSeasonFactor >= 0`, tolerances >= 0, severity in 0..3, `min <= max`.
5. Entries with `engineMethod: "reminder_only"` need no interval fields.
6. No `user` confidence in the bundled files.

### Gathering links and photos

`scripts/harvest-links.mjs` collects "learn more" links politely (one request every 3 seconds or
slower, a cache outside git, stop at the first HTTP 429) into a folder given by `--out` (default
`.cache/link-harvest/`); `scripts/apply-links.mjs` writes up to three links per language per entry.
`scripts/fetch-photos.mjs` confirms photo picks through the Wikimedia Commons API and
`scripts/apply-photos.mjs` writes the licence and creator into the entries. Both of those keep
their working files in `.cache/photos/`. Run prettier on `catalogue-draft/` afterwards.
