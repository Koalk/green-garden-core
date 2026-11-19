// SPDX-License-Identifier: AGPL-3.0-only
// The static preview build output: relative paths only, JavaScript only, no dev server. The browser
// check (headless Chrome at 390 and 1440 px) is scripts/static-check.mjs, which needs loopback
// HTTP and so cannot be a test file (check-no-network).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildStatic } from "./build-static.mjs";

const out = mkdtempSync(join(tmpdir(), "gg-static-"));
const files = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));

before(() => buildStatic(out));
after(() => rmSync(out, { recursive: true, force: true }));

describe("static build output", () => {
  it("has a page, the stylesheet and the thumbnails, with relative paths only", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(existsSync(join(out, "vendor", "pico.green.min.css")));
    assert.ok(readdirSync(join(out, "catalogue-thumbs")).some((f) => f.endsWith(".webp")));
    assert.match(html, /__GG_STATIC_PREVIEW__\s*=\s*true/);
    assert.doesNotMatch(html, /(?:src|href)="\//);
    assert.doesNotMatch(html, /"\/packages\//);
    assert.doesNotMatch(html, /\/api\/|localhost|127\.0\.0\.1/);
  });

  it("has JavaScript only: no .ts left, and every relative import points at a file", () => {
    const all = files(out);
    assert.equal(all.filter((f) => f.endsWith(".ts")).length, 0);
    const js = all.filter((f) => f.endsWith(".js"));
    assert.ok(js.length > 20);
    for (const f of js) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
        const target = normalize(join(f, "..", m[1]));
        assert.ok(existsSync(target) && statSync(target).isFile(), `${f} imports ${m[1]}`);
      }
    }
  });

  it("keeps the dev server out", () => {
    assert.doesNotMatch(files(out).join("\n"), /server\.mjs|\.env/);
  });
});
