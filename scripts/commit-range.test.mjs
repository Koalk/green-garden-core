// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pickCommitRange } from "./commit-range.mjs";

const ZERO = "0".repeat(40);
const GONE = "1a8c35b".padEnd(40, "0");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "range-"));
  const g = (...a) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a],
      {
        cwd: dir,
        encoding: "utf8",
      },
    ).trim();
  g("init", "-q", "-b", "main");
  const commit = (n) => {
    writeFileSync(join(dir, "f"), n);
    g("add", "f");
    g("commit", "-q", "-m", n);
    return g("rev-parse", "HEAD");
  };
  return { dir, g, commit };
}

test("known before hash gives before..after", () => {
  const { dir, commit } = repo();
  try {
    const a = commit("a");
    const b = commit("b");
    assert.equal(pickCommitRange(dir, a, b), `${a}..${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown before hash does not error; uses commits not on the default branch", () => {
  const { dir, g, commit } = repo();
  try {
    const a = commit("a");
    g("update-ref", "refs/remotes/origin/main", a);
    g("checkout", "-q", "-b", "topic");
    const b = commit("b");
    assert.equal(pickCommitRange(dir, GONE, b), `${a}..${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all-zero before (new branch) behaves the same", () => {
  const { dir, g, commit } = repo();
  try {
    const a = commit("a");
    g("update-ref", "refs/remotes/origin/main", a);
    const b = commit("b");
    assert.equal(pickCommitRange(dir, ZERO, b), `${a}..${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("force push to the default branch itself checks all history of after", () => {
  const { dir, g, commit } = repo();
  try {
    commit("a");
    const b = commit("b");
    g("update-ref", "refs/remotes/origin/main", b);
    assert.equal(pickCommitRange(dir, GONE, b), b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no default branch fetched falls back to all history", () => {
  const { dir, commit } = repo();
  try {
    const a = commit("a");
    assert.equal(pickCommitRange(dir, ZERO, a), a);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
