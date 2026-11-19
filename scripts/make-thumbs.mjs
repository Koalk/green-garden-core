// SPDX-License-Identifier: AGPL-3.0-only
// 320 px wide WebP thumbnails from the cached Commons copies, via ffmpeg (a local tool, not a dependency).
//   node scripts/make-thumbs.mjs <cache dir> [quality]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PHOTO_SIZES } from "../packages/catalogue/src/photos.ts";
import { root } from "./lib.mjs";

const [cacheDir, quality = "60"] = process.argv.slice(2);
if (!cacheDir) {
  console.error("usage: node scripts/make-thumbs.mjs <cache dir> [quality]");
  process.exit(2);
}
const out = join(root, "packages", "catalogue", "thumbs");
mkdirSync(out, { recursive: true });
let total = 0;
const sizes = [];
for (const f of readdirSync(cacheDir)
  .filter((n) => n.endsWith(".jpg"))
  .sort()) {
  const dest = join(out, f.replace(/\.jpg$/, ".webp"));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    join(cacheDir, f),
    "-vf",
    `scale=${PHOTO_SIZES.thumb}:-2`,
    "-c:v",
    "libwebp",
    "-quality",
    quality,
    "-frames:v",
    "1",
    dest,
  ]);
  const n = statSync(dest).size;
  sizes.push(n);
  total += n;
}
sizes.sort((a, b) => a - b);
console.log(
  `${sizes.length} thumbnails, ${(total / 1024).toFixed(0)} KB total, median ${((sizes[sizes.length >> 1] ?? 0) / 1024).toFixed(1)} KB, max ${((sizes.at(-1) ?? 0) / 1024).toFixed(1)} KB`,
);
