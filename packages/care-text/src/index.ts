// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Care wording shared by every front end: the "How much" lines and the toxicity line. Pure
 * functions that take the `Translate` to word things with, so the web UI and the Stories app say the
 * same thing from one implementation. No DOM, no storage writes.
 */
export * from "./amount.ts";
export * from "./toxicity.ts";
export * from "./health.ts";
