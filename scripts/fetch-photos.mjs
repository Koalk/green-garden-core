// SPDX-License-Identifier: AGPL-3.0-only
// confirm the photo picks through the Commons API and download 640 px copies for the thumbnails.
// No model, one request every 3 seconds, stops at the first HTTP 429 (rerun later: finished files are skipped).
//   node scripts/fetch-photos.mjs <picks.json> <cache dir> [--no-download]
// Writes <out>/commons-info.json (answers plus differences from the picks).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareWithPick, infoRequestUrl, parseInfo } from "./fetch-photos-lib.mjs";
import { root } from "./lib.mjs";

const [picksPath, cacheDir] = process.argv.slice(2);
if (!picksPath || !cacheDir) {
  console.error("usage: node scripts/fetch-photos.mjs <picks.json> <cache dir> [--no-download]");
  process.exit(2);
}
const download = !process.argv.includes("--no-download");
const UA = "green-garden-photo-script/0.1 (licence and thumbnail check)";
const PAUSE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const picks = JSON.parse(readFileSync(picksPath, "utf8")).filter((p) => p.file);
const outDir = join(root, ".cache", "photos");
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

let stopped = null;
const records = new Map();
for (let i = 0; i < picks.length && stopped === null; i += 50) {
  const batch = picks.slice(i, i + 50);
  const res = await fetch(infoRequestUrl(batch.map((p) => p.file)), {
    headers: { "User-Agent": UA },
  });
  if (res.status === 429) {
    stopped = `429 on the info request for picks ${i} to ${i + batch.length - 1}`;
    break;
  }
  if (!res.ok) throw new Error(`Commons API answered ${res.status}`);
  for (const [file, rec] of parseInfo(
    await res.json(),
    batch.map((p) => p.file),
  ))
    records.set(file, rec);
  await sleep(PAUSE_MS);
}

const report = picks.map((p) => {
  const rec = records.get(p.file);
  return {
    id: p.id,
    file: p.file,
    ...(rec ?? { missing: true, notAsked: true }),
    diffs: compareWithPick(p, rec),
  };
});
writeFileSync(
  join(outDir, "commons-info.json"),
  `${JSON.stringify({ fetchedOn: new Date().toISOString().slice(0, 10), stopped, report }, null, 1)}\n`,
);

let got = 0;
if (download && stopped === null) {
  for (const r of report) {
    const dest = join(cacheDir, `${r.id}.jpg`);
    if (!r.thumbUrl || r.licence === null || existsSync(dest)) continue;
    const res = await fetch(r.thumbUrl, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      stopped = `429 while downloading ${r.id} (${got} downloaded this run)`;
      break;
    }
    if (!res.ok) {
      console.error(`${r.id}: HTTP ${res.status}`);
      continue;
    }
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    got++;
    await sleep(PAUSE_MS);
  }
}
const withDiffs = report.filter((r) => r.diffs.length > 0);
console.log(
  `${report.length} picks, ${withDiffs.length} with differences, ${got} downloaded${stopped ? `, STOPPED: ${stopped}` : ""}`,
);
for (const r of withDiffs) console.log(`  ${r.id}: ${r.diffs.join("; ")}`);
