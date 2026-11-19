# AGENTS.md

Guidance for any AI coding assistant or human contributor working in this
repository. Tool-agnostic by design.

- Read `README.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md` first. Follow the
  commit style and dependency rules there.
- Dependencies must be permissive (MIT, Apache-2.0, BSD, ISC). Check the licence
  before adding one and update `THIRD_PARTY.md`.
- Each external source (weather, plant data, plant ID) sits behind an interface.
  Do not copy datasets or third-party code into the repo.
- Red/green testing for all code, including provisional work: every feature,
  fix and behaviour change starts with a test or vector that states the
  expected behaviour. Run it and see it fail (red), write the code until it
  passes (green), then tidy up with the tests still green. A fix for a
  reported bug starts with a test that reproduces it. Commit test and code
  together and say in the commit body which test was red first.
- Tests must not call real external services or need API keys.
- No secrets, real keys or personal data anywhere. Use `.env.example` with
  empty values.
- No logos, trademarks or generated image assets.
- Record significant decisions as ADRs in `docs/adr/`; propose, do not decide.
- Do not publish or add remotes unless the maintainer asks (pushing `main`:
  see "Public repo" below).
- Work on a branch or in a git worktree per task rather than in a checkout someone else is using.
  Never create symlinks or junctions to another checkout, and never delete a worktree with
  `rm -rf` or `Remove-Item -Recurse`: on Windows that can follow package-manager links into the
  checkout they point at. Remove worktrees with `git worktree remove`.
- Untracked files such as `.env` are not copied into a worktree; copy them from your own checkout when
  the work needs them, and never print or commit them.

## Public repo

- This repository is public (AGPL). Keep it to the repo itself: code, tests, vectors, catalogue data
  and the docs a user or contributor needs. Cite only files in this repo in code, docs and commit
  messages. No planning notes, personal names (other than copyright, licence and credit lines),
  dates of private decisions, internal task IDs, or personal data (real addresses, home
  coordinates, private network details, other people).
- `pnpm check` includes the public check (`scripts/public-check.mjs`,
  `mise run core-public-check`). It fails on secrets, `.env` files other than `.env.example`,
  personal data, and the items in the first bullet. A reviewed exception goes in
  `scripts/public-check-allow.json` with a reason.
- Only the maintainer pushes `main`, after a green `pnpm check`.