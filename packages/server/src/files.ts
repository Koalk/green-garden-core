// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One JSON file per space under the data directory. The file holds the revision counter, the
 * calendar feed token and the AppData in the X5 export format. Writes go to a temp file first and are
 * renamed into place, so a crash never leaves half a file; writes are serialised so the revision
 * check and the write cannot interleave.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReminderState } from "./reminders.ts";

export interface SpaceFile {
  readonly revision: number;
  /** Secret in the subscribable calendar URL; absent until first asked for. */
  readonly feedToken?: string;
  /** The AppData as an X5 export object. */
  readonly data: unknown;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validSpaceName(name: string): boolean {
  return NAME.test(name);
}

export class SpaceFiles {
  private readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(dir: string) {
    this.dir = dir;
  }

  private path(name: string): string {
    return join(this.dir, `${name}.json`);
  }

  async read(name: string): Promise<SpaceFile | undefined> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.path(name), "utf8"));
      if (typeof raw !== "object" || raw === null) return undefined;
      const o = raw as Record<string, unknown>;
      const revision = o["revision"];
      if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
        return undefined;
      }
      const feedToken = o["feedToken"];
      return {
        revision,
        ...(typeof feedToken === "string" ? { feedToken } : {}),
        data: o["data"],
      };
    } catch {
      return undefined;
    }
  }

  async names(): Promise<string[]> {
    try {
      return (await readdir(this.dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
        .filter(validSpaceName);
    } catch {
      return [];
    }
  }

  private async writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${file}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, join(this.dir, file));
  }

  /** Reminder bookkeeping for a space, kept apart so sending an email never changes the data revision. */
  async readState(name: string): Promise<ReminderState> {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(this.dir, `${name}.reminders.json`), "utf8"),
      );
      if (typeof raw === "object" && raw !== null && "sent" in raw) return raw as ReminderState;
    } catch {
      // no state yet
    }
    return { sent: {} };
  }

  async writeState(name: string, state: ReminderState): Promise<void> {
    await this.writeAtomic(`${name}.reminders.json`, state);
  }

  /** Runs `fn` after every earlier `update`; whatever it returns is written (undefined writes nothing). */
  update<T>(
    name: string,
    fn: (current: SpaceFile | undefined) => { file?: SpaceFile; result: T },
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const out = fn(await this.read(name));
      if (out.file !== undefined) {
        await this.writeAtomic(`${name}.json`, out.file);
      }
      return out.result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export function newFeedToken(): string {
  return randomBytes(24).toString("base64url");
}
