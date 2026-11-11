// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheStore } from "@green-garden/providers";

/**
 * The rain cache as one file in `<data dir>/cache/weather.json`, written atomically. It sits in a
 * sub-folder so it is never mistaken for a space; losing it only costs a re-fetch.
 */
export function fileCacheStore(dir: string): CacheStore {
  const folder = join(dir, "cache");
  const file = join(folder, "weather.json");
  return {
    async load(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch {
        return undefined;
      }
    },
    async save(value: unknown): Promise<void> {
      await mkdir(folder, { recursive: true });
      const tmp = join(folder, `.weather.${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(tmp, JSON.stringify(value), "utf8");
      await rename(tmp, file);
    },
  };
}
