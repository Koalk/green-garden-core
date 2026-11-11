// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A small subset of ICU MessageFormat: `{arg}`, `{arg, number}`, `{arg, plural, =0 {..} one {..} other {..}}`
 * with `#`, `{arg, select, a {..} other {..}}`, and apostrophe quoting of braces. The message files are
 * ordinary ICU strings, so they can move to `intl-messageformat` unchanged when the web UI gets a
 * bundler (the dev server serves source files only and cannot load a node_modules package).
 */

type Node =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "hash" }
  | { readonly t: "arg"; readonly name: string; readonly kind?: "number" }
  | {
      readonly t: "plural" | "select";
      readonly name: string;
      readonly cases: ReadonlyMap<string, readonly Node[]>;
    };

export type Params = Readonly<Record<string, string | number>>;

class Parser {
  private i = 0;
  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  parse(): Node[] {
    const out = this.sequence(false);
    if (this.i < this.src.length) throw new Error(`unexpected "}" at ${String(this.i)}`);
    return out;
  }

  private sequence(inBranch: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = (): void => {
      if (text !== "") out.push({ t: "text", v: text });
      text = "";
    };
    while (this.i < this.src.length) {
      const c = this.src[this.i] as string;
      if (c === "'") {
        const next = this.src[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === "{" || next === "}") {
          // quoted literal run up to the closing apostrophe
          this.i += 1;
          while (this.i < this.src.length && this.src[this.i] !== "'") {
            text += this.src[this.i] as string;
            this.i += 1;
          }
          this.i += 1;
        } else {
          text += "'";
          this.i += 1;
        }
      } else if (c === "{") {
        flush();
        out.push(this.argument());
      } else if (c === "}") {
        if (inBranch) break;
        throw new Error(`unexpected "}" at ${String(this.i)}`);
      } else if (c === "#" && inBranch) {
        flush();
        out.push({ t: "hash" });
        this.i += 1;
      } else {
        text += c;
        this.i += 1;
      }
    }
    flush();
    return out;
  }

  private ws(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] as string)) this.i += 1;
  }

  private word(): string {
    const m = /^[^\s,{}]+/.exec(this.src.slice(this.i));
    if (m === null) throw new Error(`expected a name at ${String(this.i)}`);
    this.i += m[0].length;
    return m[0];
  }

  private expect(ch: string): void {
    if (this.src[this.i] !== ch) throw new Error(`expected "${ch}" at ${String(this.i)}`);
    this.i += 1;
  }

  private argument(): Node {
    this.expect("{");
    this.ws();
    const name = this.word();
    this.ws();
    if (this.src[this.i] === "}") {
      this.i += 1;
      return { t: "arg", name };
    }
    this.expect(",");
    this.ws();
    const kind = this.word();
    this.ws();
    if (kind === "number") {
      this.expect("}");
      return { t: "arg", name, kind: "number" };
    }
    if (kind !== "plural" && kind !== "select") throw new Error(`unknown argument type "${kind}"`);
    this.expect(",");
    const cases = new Map<string, readonly Node[]>();
    for (;;) {
      this.ws();
      if (this.src[this.i] === "}") break;
      const key = this.word();
      this.ws();
      this.expect("{");
      cases.set(key, this.sequence(true));
      this.expect("}");
    }
    this.expect("}");
    if (!cases.has("other")) throw new Error(`"${name}" needs an "other" case`);
    return { t: kind, name, cases };
  }
}

/**
 * CLDR plural categories for the locales core ships (en, es, it). `Intl.PluralRules` is used when the
 * runtime has it; Hermes on Android does not, and without this fallback every plural message threw and
 * the screen showed its key.
 */
function pluralCategory(locale: string, n: number): string {
  if (typeof Intl.PluralRules === "function") return new Intl.PluralRules(locale).select(n);
  const abs = Math.abs(n);
  const text = String(abs);
  const whole = Number.isInteger(abs);
  if (text.includes("e")) return "other";
  const lang = locale.split("-")[0]?.toLowerCase();
  if (lang === "es" || lang === "it") {
    if (abs === 1) return "one";
    return whole && abs !== 0 && abs % 1000000 === 0 ? "many" : "other";
  }
  return abs === 1 ? "one" : "other";
}

const parsed = new Map<string, readonly Node[]>();
function parse(src: string): readonly Node[] {
  let nodes = parsed.get(src);
  if (nodes === undefined) {
    nodes = new Parser(src).parse();
    parsed.set(src, nodes);
  }
  return nodes;
}

function render(nodes: readonly Node[], params: Params, locale: string, hash?: number): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v;
        break;
      case "hash":
        out += new Intl.NumberFormat(locale).format(hash ?? 0);
        break;
      case "arg": {
        const v = params[n.name];
        if (v === undefined) out += `{${n.name}}`;
        else if (n.kind === "number") out += new Intl.NumberFormat(locale).format(Number(v));
        else out += String(v);
        break;
      }
      case "select": {
        const v = String(params[n.name] ?? "other");
        out += render(n.cases.get(v) ?? (n.cases.get("other") as readonly Node[]), params, locale);
        break;
      }
      case "plural": {
        const raw = params[n.name];
        const num = Number(raw);
        if (raw === undefined || !Number.isFinite(num)) {
          out += `{${n.name}}`;
          break;
        }
        const cat = pluralCategory(locale, num);
        const branch =
          n.cases.get(`=${String(num)}`) ?? n.cases.get(cat) ?? n.cases.get("other") ?? [];
        out += render(branch, params, locale, num);
        break;
      }
    }
  }
  return out;
}

/** Formats one message. Throws on a syntax error. A missing argument stays visible as `{name}`. */
export function formatMessage(template: string, params: Params, locale: string): string {
  return render(parse(template), params, locale);
}

/** Argument names a message uses, sorted, for checking that a translation keeps the same ones. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.t === "arg") names.add(n.name);
      else if (n.t === "plural" || n.t === "select") {
        names.add(n.name);
        for (const branch of n.cases.values()) walk(branch);
      }
    }
  };
  walk(parse(template));
  return [...names].sort();
}

/** Case selectors of every plural in a message (`=0`, `one`, `other`, ...), nested ones included. */
export function pluralKeysOf(template: string): string[] {
  const keys: string[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.t === "plural" || n.t === "select") {
        if (n.t === "plural") keys.push(...n.cases.keys());
        for (const branch of n.cases.values()) walk(branch);
      }
    }
  };
  walk(parse(template));
  return keys;
}
