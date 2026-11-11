// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadVectors, project, runVector } from "./runner.ts";

const vectors = loadVectors();

describe("golden vectors", () => {
  it("has at least one vector", () => {
    assert.ok(vectors.length > 0);
  });
  for (const v of vectors) {
    it(v.name, () => {
      const actual = runVector(v);
      assert.deepEqual(project(actual, v.expected), v.expected);
      // A listed array must also have the listed length.
      if (Array.isArray(v.expected)) assert.equal((actual as unknown[]).length, v.expected.length);
    });
  }
});
