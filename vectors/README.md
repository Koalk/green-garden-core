# Golden vectors

Language-neutral JSON files in `cases/`: `{ name, description, why, fn, input, expected }`.
Any implementation in any language runs a thin runner over them. The TypeScript
runner is `runner.ts`; it needs no network.

- `fn` names the engine function (`bandTable`, `computeWindows`, `planDays`,
  `wateringHint`, `startMultipliers`, `restWeight`); the default is `computeWindows`.
- `expected` is a subset of the output: only the keys and array elements listed
  are compared, so ports may add fields. A listed array also fixes the length of
  the top-level result.
- `why` says where the expected value comes from (a documented worked example, or
  a hand computation from the stated rules).
- A change to a vector needs a note saying why.

Unit and property tests for the engine live next to the runner (`engine.test.ts`,
`properties.test.ts`) because `packages/engine` may not import anything, not even
`node:test`.
