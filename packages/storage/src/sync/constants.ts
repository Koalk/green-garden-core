// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How long sync keeps things, in one place. Both values are provisional: they are the numbers the
 * design starts with and may move once households use them.
 */

/** A plant's checkpoint cutoff sits this many days back; log entries before it are dropped. */
export const CHECKPOINT_CUTOFF_DAYS = 60;

/** A removal record older than this many days is dropped once every member has seen past it. */
export const TOMBSTONE_KEEP_DAYS = 180;
