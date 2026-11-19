// SPDX-License-Identifier: AGPL-3.0-only
// Pick the git range the CI commit-message check walks for a push.
import { execFileSync } from "node:child_process";

const ZEROS = /^0+$/;

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const isCommit = (cwd, rev) => git(cwd, ["cat-file", "-e", `${rev}^{commit}`]) !== null;

/**
 * `before..after` when `before` is a commit in history. Otherwise (force push, new branch: the hash is
 * unknown or all zeros) the commits of `after` that are not on the fetched default branch; when `after`
 * is that branch's tip, or the branch is not fetched, all of `after`'s history. Never throws on a
 * missing hash.
 */
export function pickCommitRange(cwd, before, after, defaultBranch = "origin/main") {
  if (before && !ZEROS.test(before) && isCommit(cwd, before)) return `${before}..${after}`;
  const base = isCommit(cwd, defaultBranch)
    ? git(cwd, ["rev-parse", `${defaultBranch}^{commit}`])
    : null;
  const tip = git(cwd, ["rev-parse", `${after}^{commit}`]);
  if (base && tip && base !== tip) return `${base}..${after}`;
  return after;
}
