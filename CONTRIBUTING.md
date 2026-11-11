# Contributing

Thanks for helping. This project is pre-alpha; this guide describes how contributions work.

## Before you start

1. Open an issue before large changes.
2. Sign the Contributor Licence Agreement ([`docs/licensing/CLA.md`](docs/licensing/CLA.md))
   on your first pull request. You keep your copyright. The CLA lets the
   maintainer license your contribution under other terms, including proprietary ones.

## Rules for all contributions

- Only submit code you have the right to submit.
- Do not copy code from projects with incompatible licences. Name any
  third-party code and its licence in the pull request.
- Dependencies must be permissive (MIT, Apache-2.0, BSD, ISC). No GPL, AGPL or
  LGPL. State the licence of any new dependency in the pull request.
- Plant data sources must allow redistribution and commercial use, or be
  fetched at runtime. Record licence and attribution in `THIRD_PARTY.md`.
- Never commit secrets. Use `.env` (git-ignored); keep `.env.example` empty.
- Red/green testing: write the test or vector that states the expected
  behaviour first, run it and see it fail, then write the code until it
  passes and tidy up with the tests still green. A bug fix starts with a test
  that reproduces the bug. Commit test and code together; say in the commit
  body which test was red first.
- Tests must not call real external services or need API keys.
- If you used an AI tool, you are responsible for the result: review it, and
  make sure it does not reproduce code you cannot licence.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/), checked by a
git hook. Enable it once after cloning:

```sh
sh scripts/setup-hooks.sh
```

Format: `type(scope): subject`

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`
- Scope is optional, lowercase (for example `weather`, `sun`, `docs`)
- Subject: imperative mood, at most 72 characters, no trailing full stop
- Breaking changes: add `!` before the colon, and explain in the body
- Examples: `feat(weather): add open-meteo adapter`, `docs: clarify cla scope`

## Branches and pull requests

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`.
- Keep pull requests small and focused; squash-merge with a Conventional
  Commit title.
- Use the pull request template checklist.

## Decisions

Significant technical decisions are recorded as ADRs in `docs/adr/`.

## Translating
Interface text lives in `packages/i18n/src/locales/`. Fixing a translation or adding a language is a
contribution anyone can make without touching code: see [docs/translating.md](docs/translating.md). CI
runs `pnpm i18n:check` (ICU syntax, placeholders, plural categories, unused and unknown keys).
