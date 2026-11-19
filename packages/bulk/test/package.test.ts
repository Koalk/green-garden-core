// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyData } from "@green-garden/storage";
import { nextId, saveBulk, startBulk, validatePlantFields } from "../src/index.ts";

const src = `${import.meta.dirname}/../src`;
const files = readdirSync(src).filter((f) => f.endsWith(".ts"));
const imports = (f: string): string[] =>
  [...readFileSync(`${src}/${f}`, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");

describe("@green-garden/bulk stands on its own", () => {
  it("imports nothing from web-ui and nothing that touches the DOM", () => {
    assert.ok(files.length >= 4);
    for (const f of files) {
      for (const spec of imports(f)) {
        assert.doesNotMatch(spec, /web-ui|pilot-data|\.\.\//, `${f}: ${spec}`);
      }
      assert.doesNotMatch(readFileSync(`${src}/${f}`, "utf8"), /\bdocument\.|\bwindow\./, f);
    }
  });

  it("species always come in as an argument: no default list", () => {
    const empty = saveBulk(emptyData(), startBulk(""), "2026-10-30", []);
    assert.equal(empty.saved, 0);
    assert.equal(saveBulk.length, 4, "saveBulk(data, state, today, species)");
  });

  it("strings come in through a Translate, not web-ui's t", () => {
    const keys: string[] = [];
    const tr = (k: string): string => {
      keys.push(k);
      return `<${k}>`;
    };
    assert.deepEqual(validatePlantFields({}, tr), [
      "<error.name>",
      "<error.style>",
      "<error.interval>",
    ]);
    assert.deepEqual(keys, ["error.name", "error.style", "error.interval"]);
  });

  it("nextId lives here too", () => {
    assert.equal(nextId(["p1", "p3"], "p"), "p2");
  });
});
