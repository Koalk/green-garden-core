// SPDX-License-Identifier: AGPL-3.0-only
// Rules of the public-repo check (core is public): no private Stories paths, secrets, .env
// content or personal data. No dependencies, no model. Split out so the rules can be tested.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER_DOMAINS =
  /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|localhost)\b/i;

/** Kinds that only report until the tree is swept clean; the rest always fail. */
export const REPORT_ONLY_KINDS = new Set([
  "owner-name",
  "decision-date",
  "session-id",
  "private-matter",
]);

const isNameExempt = (f) => /(?:^|\/)(?:LICENSE|THIRD_PARTY\.md)$/.test(f);

/** Per-line rules: kind and a test on the line. */
const lineRules = [
  {
    kind: "private-path",
    test: (l) => /green-garden-stories|docs\/planning|PROJECT_CONTEXT|docs\/legal/.test(l),
  },
  {
    // The owner's name, except in copyright lines and (via isNameExempt) licence and credits files.
    kind: "owner-name",
    test: (l, f) =>
      !isNameExempt(f) && /\b(?:Dani|Daniel)\b/.test(l) && !/copyright|\(c\)|©/i.test(l),
  },
  { kind: "decision-date", test: (l) => /\bDani 20\d\d-|\bDecided 20\d\d/.test(l) },
  {
    kind: "session-id",
    test: (l) =>
      /\bS\d{2,3}\b|PROVISIONAL\(S|\bV-\d+\b|\borch\d+\b|\bIN-(?:S|A|V)?[A-Za-z0-9]*-?\d/.test(l),
  },
  {
    kind: "private-matter",
    test: (l) => /\b(?:consent|employer|employment)\b|\blegal (?:decision|matter)s?\b/i.test(l),
  },
  {
    kind: "secret",
    test: (l) =>
      /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/.test(l) ||
      /\bsk-[A-Za-z0-9]{20,}/.test(l) ||
      /\bAKIA[0-9A-Z]{16}\b/.test(l) ||
      /\bxox[abprs]-[A-Za-z0-9-]{10,}/.test(l) ||
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l) ||
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(l),
  },
  {
    // Long hex or base64 runs; skipped in tests and fixtures (see isTestOrFixture).
    kind: "secret",
    skipInTests: true,
    test: (l) => /\b[0-9a-fA-F]{32,}\b/.test(l) && !/\b(?:sha\d*|integrity|hash)\b/i.test(l),
  },
  {
    kind: "email",
    test: (l) => {
      const m = l.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [];
      return m.some(
        (e) =>
          !PLACEHOLDER_DOMAINS.test(e) &&
          !/^[^@]*@\d/.test(e) &&
          !/\.(?:png|jpe?g|webp|svg)$/i.test(e),
      );
    },
  },
  {
    kind: "phone",
    test: (l) => /(?<![\w.])\+\d{1,3}[ -]?\(?\d{2,5}\)?[ -]\d{3,4}[ -]?\d{3,4}(?![\w.])/.test(l),
  },
  {
    kind: "private-ip",
    test: (l) => {
      for (const m of l.matchAll(
        /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.(\d{1,3})\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
      )) {
        // 192.168.1.x and 192.168.0.x are the documented examples.
        if (m[2] === "1" || m[2] === "0") continue;
        return true;
      }
      return false;
    },
  },
  {
    // Decimal coordinates with 5+ decimals next to lat/lon words.
    kind: "coordinates",
    skipInTests: true,
    test: (l) =>
      /\b(?:lat(?:itude)?|lon(?:gitude)?|lng)\b["']?\s*[:=]\s*-?\d{1,3}\.\d{5,}/i.test(l),
  },
];

export const isTestOrFixture = (f) =>
  /(?:\.test\.|\.spec\.|(?:^|\/)(?:fixtures?|vectors|__tests__)\/)/.test(f);
const isEnvFile = (f) => /(?:^|\/)\.env(?:\..+)?$/.test(f) && !/\.env\.example$/.test(f);

/** Validate allow-list entries: each needs file, kind and a non-empty reason. */
export function checkAllowList(allow) {
  for (const e of allow) {
    if (!e.file || !e.kind || !String(e.reason ?? "").trim()) {
      throw new Error(`allow-list entry needs file, kind and a reason: ${JSON.stringify(e)}`);
    }
  }
}

/** Scan repo-relative files under dir; returns [{file, line, kind}]. */
export function scanFiles(dir, files, allow = []) {
  checkAllowList(allow);
  const allowed = (file, kind) => allow.some((e) => e.file === file && e.kind === kind);
  const out = [];
  const add = (file, line, kind) => {
    if (!allowed(file, kind)) out.push({ file, line, kind });
  };
  for (const file of files) {
    if (isEnvFile(file)) {
      add(file, 1, "env-file");
      continue;
    }
    let text;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue; // binary
    const test = isTestOrFixture(file);
    text.split("\n").forEach((line, i) => {
      for (const rule of lineRules) {
        if (rule.skipInTests && test) continue;
        if (rule.test(line, file)) add(file, i + 1, rule.kind);
      }
    });
  }
  return out;
}
