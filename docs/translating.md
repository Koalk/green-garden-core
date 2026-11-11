# Translating Green Garden Core

The interface speaks English (UK), Spanish and Italian. Spanish and Italian are machine drafts until a
native reader signs them off (decision D-30); the language picker says so. This page is for anyone who
wants to fix a translation or add a language.

## What gets translated

- **The interface text**: `packages/i18n/src/locales/<tag>.json`, one flat file per language.
- **Not translated**: names you type (plants, rooms, notes) and anything the care data says in English
  when no translation exists. Care text falls back to English per string.

## House style

- Write labels and buttons as actions or nouns ("Regar", "Annaffiare"), not as sentences about a plant.
  Spanish and Italian adjectives and participles agree with the noun ("regada", "annaffiate"), and the app
  does not know a plant's grammatical gender. Avoid the problem instead of working around it.
- Keep the tone plain and short. Match the English length where you can; labels sit in narrow buttons.
- Units are metric. A "cup" is not a household measure in Spain or Italy; the Spanish file says "vaso", the
  Italian one "bicchiere". Pick the word people there actually use.
- Safety wording (toxicity, "treat it as possibly harmful") must not be softened. If unsure, keep it
  literal and leave the file marked as machine translated.

## Reading the messages

Messages use ICU MessageFormat. You only need three shapes.

```
"card.next": "Next: {next}"                       a value is inserted where {next} is
"notice.wateredAll": "Marked {n, plural, one {# plant} other {# plants}} watered."
"x": "{kind, select, a {Alpha} other {Other}}"     choose by a word
```

- Keep every `{placeholder}` exactly as written; only the text around it changes.
- In a plural, `#` is the number. Write one case per plural category your language has. Spanish and
  Italian need `one` and `other`; `other` is always required. `=0 {...}` matches exactly zero.
- A literal brace is written `'{'` and `'}'`. A lone apostrophe (`l'ideale`) needs nothing special.
- A few messages carry `<strong>` tags. Keep them.
- `{n, number}` formats a number the way your language writes it (1,5 in Spanish and Italian).

## Fixing a translation

1. Edit the value in `packages/i18n/src/locales/<tag>.json`. Never change a key.
2. Run `mise run i18n-check` (or `pnpm i18n:check`). It rejects broken ICU syntax, changed placeholders,
   plural categories your language does not have, unknown keys and, for a reviewed language, missing keys.
3. When you have read the whole file and are happy with it, set `"machine": false` for your language in
   `packages/i18n/src/locales/meta.json`. That removes the "machine translated" label.

## Adding a language

1. `pnpm i18n:new <tag> "<language name in that language>"`, for example `pnpm i18n:new de Deutsch`. It
   creates `locales/de.json` filled with the English text, registers the language as a machine draft in
   `meta.json` and regenerates `src/catalogues.ts`.
2. Translate the values. Untranslated entries simply show English until you get to them.
3. Run `pnpm i18n:check`, open the app, pick the language under Settings, then Language, and look at every
   tab. German and French strings are longer than English: check the buttons.
4. Open a pull request. Say whether you are a native speaker and whether you clicked through the app.

Translations are covered by the same licence and the same contributor agreement as the rest of the code
(see `CONTRIBUTING.md`).

## Plant names and care text

Common names and watering tips in the catalogue are lists with one entry per language
(`{ "lang": "es", "name": "...", "translation": { "status": "machine" } }`). English (`en-GB`) must always
be present. Every non-English entry says `machine`, or `reviewed` with `reviewedBy`. The catalogue
validator checks this.

## Why the message code is our own

The messages are ordinary ICU strings, but the formatter is a small subset implemented in
`packages/i18n/src/message.ts`. The dev server serves source files without a bundler, so a package from
`node_modules` cannot be loaded in the browser. When the web UI gets a build step, the same files can be fed
to `intl-messageformat` unchanged.
