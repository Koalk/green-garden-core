// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structural and rule checks for catalogue files (packages/catalogue/README.md, "Catalogue files and validation").
 * Dependency-free. PROVISIONAL: also checks the pilot extensions `corroboratedBy` on values and
 * `access` on sources, and allows an open-ended bound (`null`) in a min/max range.
 */

import { LINK_KINDS, type LinkKind } from "./links.ts";

const DEFAULT_LANG = "en-GB";

/** A BCP 47 language tag: language, optional script and region, nothing exotic. */
function isLangTag(s: string): boolean {
  return /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/.test(s);
}

/**
 * Checks a list of `{lang, <textKey>, translation?}` items: valid BCP 47 tag, non-empty text, and a
 * translation status (or, for names, a `source` from the sources list) on everything that is not
 * the default language. Several items per language are allowed: extra items are that language's aliases. Returns the languages seen.
 */
function langItems(
  path: string,
  items: readonly unknown[],
  textKey: string,
  err: (where: string, msg: string) => void,
  isSource: (id: string) => boolean = () => false,
): string[] {
  const langs: string[] = [];
  for (const x of items) {
    if (!isObj(x) || typeof x["lang"] !== "string" || !isLangTag(x["lang"])) {
      err(path, "needs a lang that is a BCP 47 tag, for example en-GB or es");
      continue;
    }
    const text = x[textKey];
    if (typeof text !== "string" || text.trim() === "") {
      err(path, "needs text");
      continue;
    }
    langs.push(x["lang"]);
    if (x["lang"] !== DEFAULT_LANG) {
      const tr = x["translation"];
      const ok =
        (isObj(tr) &&
          (tr["status"] === "machine" || tr["status"] === "reviewed") &&
          (tr["status"] === "machine" || typeof tr["reviewedBy"] === "string")) ||
        (typeof x["source"] === "string" && isSource(x["source"]));
      if (!ok) {
        err(
          path,
          "a translated entry needs translation status machine, or reviewed with reviewedBy, or a source from the sources list",
        );
      }
    }
  }
  return langs;
}

/** True for a real calendar date written as YYYY-MM-DD. */
function isDate(s: string): boolean {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

const CONFIDENCE = ["checked", "from_knowledge_verify", "guess", "unknown"] as const;
const SOURCE_KINDS = [
  "extension",
  "society",
  "botanic_garden",
  "database",
  "book",
  "author_knowledge",
];
const ACCESS = ["fetched", "search_summary"];
const STYLES = ["keep_moist", "let_top_dry", "let_fully_dry"];
const LIGHT = ["low", "medium", "bright_indirect", "direct"];
const GROWTH = ["slow", "medium", "fast"];
const HABIT = ["upright", "trailing", "rosette", "climbing", "bushy"];
const WHO = ["cat", "dog", "small_pet", "child", "adult"];
const ROUTE = ["ingest", "skin", "eye", "allergy"];
const SYMPTOMS = [
  "oral_irritation",
  "drooling",
  "vomiting",
  "diarrhoea",
  "lethargy",
  "skin_irritation",
  "swelling",
  "cardiac",
  "tremor",
  "kidney",
  "liver",
];
// in-ground and outdoor fields, life cycle, water-need ratio.
const PLACEMENT = ["indoor", "pot_outdoor", "ground"];
const HARDINESS = ["H1a", "H1b", "H1c", "H2", "H3", "H4", "H5", "H6", "H7"];
const ROOT_DEPTH = ["shallow", "medium", "deep"];
const TOLERANCE = ["none", "moderate", "high"];
const DORMANCY = ["none", "winter", "summer"];
const SUN_NEED = ["full", "part", "shade"];
const SOIL_PREF = ["free_draining", "any", "moist"];
const LIFECYCLE = ["annual", "biennial", "perennial"];
/** Share of ET0 for plants outdoors. */
const WATER_NEED_RATIO = { min: 0.1, max: 1.5 };
/** Every CC BY and CC BY-SA version (2.0, 3.0, 4.0), CC0 and public domain. The version stays in the stored string so the credit names it. */
const PHOTO_LICENCE = /^(?:CC-BY(?:-SA)?-(?:2\.0|3\.0|4\.0)|CC0-1\.0|PDM-1\.0)$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Returns a list of problems, empty when the file is valid. Never throws. */
export function validateCatalogue(file: unknown): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string): void => {
    errors.push(`${where}: ${msg}`);
  };
  if (!isObj(file)) return ["file: not an object"];
  if (file["schemaVersion"] !== 1) err("file", "schemaVersion must be 1");
  const gen = file["generatedOn"];
  if (typeof gen !== "string" || !isDate(gen)) err("file", "bad generatedOn");

  const kinds = new Map<string, string>();
  if (!Array.isArray(file["sources"])) err("file", "sources must be an array");
  else {
    for (const s of file["sources"] as unknown[]) {
      if (!isObj(s) || typeof s["id"] !== "string" || s["id"] === "") {
        err("sources", "source without id");
        continue;
      }
      const id = s["id"];
      if (kinds.has(id)) err(`source ${id}`, "duplicate id");
      const kind = typeof s["kind"] === "string" ? s["kind"] : "";
      if (!SOURCE_KINDS.includes(kind)) err(`source ${id}`, `bad kind ${kind}`);
      kinds.set(id, kind);
      if (typeof s["title"] !== "string" || s["title"] === "") err(`source ${id}`, "no title");
      if (kind !== "author_knowledge") {
        const url = s["url"];
        if (typeof url !== "string" || !/^https:\/\/[^\s]+$/.test(url)) {
          err(`source ${id}`, "needs an https url");
        }
        if (typeof s["retrievedOn"] !== "string" || !isDate(s["retrievedOn"])) {
          err(`source ${id}`, "needs retrievedOn");
        }
        if (!ACCESS.includes(String(s["access"]))) err(`source ${id}`, "needs access");
        if (typeof s["lang"] !== "string" || !/^[a-z]{2,3}$/.test(s["lang"])) {
          err(`source ${id}`, "needs lang, a base language such as en");
        }
        if (s["linkKind"] !== undefined && !LINK_KINDS.includes(s["linkKind"] as LinkKind)) {
          err(`source ${id}`, "linkKind must be care, toxicity or botanical");
        }
      }
    }
  }
  const urls = new Map<string, string>();
  const access = new Map<string, string>();
  if (Array.isArray(file["sources"])) {
    for (const s of file["sources"] as unknown[]) {
      if (isObj(s) && typeof s["id"] === "string") {
        urls.set(s["id"], typeof s["url"] === "string" ? s["url"] : "");
        access.set(s["id"], typeof s["access"] === "string" ? s["access"] : "");
      }
    }
  }
  /** Source ids cited by the entry being checked (each must have been fetched and listed). */
  let cited = new Set<string>();
  const known = (id: unknown): id is string => {
    if (typeof id === "string" && kinds.has(id)) {
      cited.add(id);
      return true;
    }
    return false;
  };

  const value = (where: string, v: unknown, check: (x: unknown) => boolean): void => {
    if (!isObj(v)) {
      err(where, "not a value object");
      return;
    }
    const conf = v["confidence"];
    if (!CONFIDENCE.includes(conf as (typeof CONFIDENCE)[number])) err(where, "bad confidence");
    if (conf === "user") err(where, "user confidence in the bundled catalogue");
    if (v["value"] === null) {
      if (conf !== "unknown") err(where, "null value needs confidence unknown");
      return;
    }
    if (!check(v["value"])) err(where, `bad value ${JSON.stringify(v["value"])}`);
    if (!known(v["source"])) err(where, "source missing from the sources list");
    else if (conf === "checked" && kinds.get(v["source"]) === "author_knowledge") {
      err(where, "checked needs a real source, not author knowledge");
    }
    if (conf === "unknown") err(where, "unknown confidence with a value");
    const more = v["corroboratedBy"];
    if (more !== undefined) {
      if (!Array.isArray(more)) err(where, "corroboratedBy must be an array");
      else {
        for (const id of more as unknown[]) {
          if (!known(id)) err(where, `corroboratedBy ${String(id)} not in sources`);
          else if (id === v["source"]) err(where, "corroboratedBy repeats the main source");
        }
      }
    }
  };
  const oneOf = (list: readonly string[]) => (x: unknown) =>
    typeof x === "string" && list.includes(x);
  const nonNeg = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x) && x >= 0;
  const range = (x: unknown): boolean => {
    if (!isObj(x)) return false;
    const { min, max } = x;
    const ok = (n: unknown): boolean => n === null || (typeof n === "number" && Number.isFinite(n));
    if (!ok(min) || !ok(max)) return false;
    return typeof min !== "number" || typeof max !== "number" || min <= max;
  };

  const entries: unknown = file["entries"];
  if (!Array.isArray(entries)) {
    err("file", "entries must be an array");
    return errors;
  }
  const ids = new Set<string>();
  for (const e of entries as unknown[]) {
    if (!isObj(e)) {
      err("entries", "entry is not an object");
      continue;
    }
    const id = typeof e["id"] === "string" ? e["id"] : "?";
    cited = new Set<string>();
    const at = (s: string): string => `${id}.${s}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) err(id, "id must be a lowercase slug");
    if (ids.has(id)) err(id, "duplicate id");
    ids.add(id);
    if (e["schemaVersion"] !== 1) err(id, "schemaVersion must be 1");
    const taxon = e["taxon"];
    if (!isObj(taxon) || typeof taxon["scientificName"] !== "string") err(id, "no scientificName");
    const names = e["names"];
    if (!isObj(names) || !Array.isArray(names["common"]) || names["common"].length === 0) {
      err(id, "needs at least one common name");
    } else {
      const items = langItems(at("names.common"), names["common"], "name", err, (sid) =>
        kinds.has(sid),
      );
      if (!items.includes(DEFAULT_LANG)) err(id, `needs an ${DEFAULT_LANG} common name`);
    }

    const care = e["care"];
    if (!isObj(care)) {
      err(id, "no care");
    } else {
      const interval = care["engineMethod"] === "interval";
      if (care["engineMethod"] !== "interval" && care["engineMethod"] !== "reminder_only") {
        err(at("engineMethod"), "must be interval or reminder_only");
      }
      value(at("wateringStyle"), care["wateringStyle"], oneOf(STYLES));
      if (interval) {
        value(at("baseIntervalDays"), care["baseIntervalDays"], (x) => nonNeg(x) && Number(x) >= 1);
        value(at("restSeasonFactor"), care["restSeasonFactor"], (x) => nonNeg(x) && Number(x) > 0);
        value(at("dryToleranceDays"), care["dryToleranceDays"], nonNeg);
        value(at("wetToleranceDays"), care["wetToleranceDays"], nonNeg);
      }
      const tip = care["wateringTip"];
      const tips: unknown[] = Array.isArray(tip) ? tip : [tip];
      const tipLangs = langItems(at("wateringTip"), tips, "text", err);
      if (tipLangs.length > 0 && !tipLangs.includes(DEFAULT_LANG)) {
        err(at("wateringTip"), `needs an ${DEFAULT_LANG} text`);
      }
      for (const x of tips) {
        if (isObj(x) && typeof x["text"] === "string" && x["text"].length > 200) {
          err(at("wateringTip"), "too long, keep one sentence");
        }
      }
      value(at("light"), care["light"], oneOf(LIGHT));
      value(at("temperatureC"), care["temperatureC"], range);
      value(at("humidityPercent"), care["humidityPercent"], range);
      value(
        at("matureSizeCm"),
        care["matureSizeCm"],
        (x) => isObj(x) && nonNeg(x["height"]) && nonNeg(x["spread"]),
      );
      value(at("growthRate"), care["growthRate"], oneOf(GROWTH));
      value(at("habit"), care["habit"], oneOf(HABIT));

      // optional fields: a missing field means "not researched yet", as for lookAlikes.
      const optional = (k: string, check: (x: unknown) => boolean): void => {
        if (care[k] !== undefined) value(at(k), care[k], check);
      };
      optional(
        "placement",
        (x) =>
          Array.isArray(x) &&
          x.length > 0 &&
          new Set(x).size === x.length &&
          x.every((p) => typeof p === "string" && PLACEMENT.includes(p)),
      );
      optional("hardiness", oneOf(HARDINESS));
      optional("rootDepthClass", oneOf(ROOT_DEPTH));
      optional("droughtTolerance", oneOf(TOLERANCE));
      optional("dormancy", oneOf(DORMANCY));
      optional("sunNeed", oneOf(SUN_NEED));
      optional("soilPreference", oneOf(SOIL_PREF));
      optional("lifecycle", oneOf(LIFECYCLE));
      optional(
        "waterNeedRatio",
        (x) => typeof x === "number" && x >= WATER_NEED_RATIO.min && x <= WATER_NEED_RATIO.max,
      );
      const ratio = care["waterNeedRatio"];
      if (isObj(ratio) && ratio["value"] !== null) {
        const place = care["placement"];
        const where = isObj(place) && Array.isArray(place["value"]) ? place["value"] : [];
        if (!where.includes("pot_outdoor") && !where.includes("ground")) {
          err(at("waterNeedRatio"), "needs a placement that includes pot_outdoor or ground");
        }
      }
      const est = care["establishment"];
      if (est !== undefined) {
        if (!isObj(est)) err(at("establishment"), "must be an object");
        else {
          value(at("establishment.seasons"), est["seasons"], (x) => x === 1 || x === 2 || x === 3);
          value(
            at("establishment.intervalDays"),
            est["intervalDays"],
            (x) => nonNeg(x) && Number(x) >= 1,
          );
        }
      }
      const groundTip = care["wateringTipGround"];
      if (groundTip !== undefined) {
        const gt: unknown[] = Array.isArray(groundTip) ? groundTip : [groundTip];
        const gtLangs = langItems(at("wateringTipGround"), gt, "text", err);
        if (!gtLangs.includes(DEFAULT_LANG)) {
          err(at("wateringTipGround"), `needs an ${DEFAULT_LANG} text`);
        }
        for (const x of gt) {
          if (isObj(x) && typeof x["text"] === "string" && x["text"].length > 200) {
            err(at("wateringTipGround"), "too long, keep one sentence");
          }
        }
      }
    }

    const tox = e["toxicity"];
    if (!isObj(tox)) {
      err(id, "no toxicity");
    } else {
      const exposures: unknown[] = Array.isArray(tox["exposures"]) ? tox["exposures"] : [];
      if (tox["status"] === "unknown") {
        if (exposures.length > 0) err(at("toxicity"), "unknown status must have no exposures");
      } else if (tox["status"] === "assessed") {
        if (exposures.length === 0) err(at("toxicity"), "assessed needs exposures");
      } else err(at("toxicity"), "status must be assessed or unknown");
      for (const x of exposures) {
        if (!isObj(x)) {
          err(at("toxicity"), "exposure is not an object");
          continue;
        }
        const w = `${at("toxicity")}.${String(x["who"])}.${String(x["route"])}`;
        if (!WHO.includes(String(x["who"]))) err(w, "bad who");
        if (!ROUTE.includes(String(x["route"]))) err(w, "bad route");
        if (![0, 1, 2, 3].includes(x["severity"] as number)) err(w, "severity must be 0 to 3");
        const sy: unknown[] = Array.isArray(x["symptoms"]) ? x["symptoms"] : [];
        if (!Array.isArray(x["symptoms"])) err(w, "symptoms must be an array");
        for (const s of sy)
          if (!SYMPTOMS.includes(String(s))) err(w, `unknown symptom ${String(s)}`);
        if (x["severity"] === 0 && sy.length > 0) err(w, "severity 0 with symptoms");
        if (!known(x["source"])) err(w, "source missing from the sources list");
        else if (x["confidence"] === "checked" && kinds.get(x["source"]) === "author_knowledge") {
          err(w, "checked needs a real source");
        }
        if (!CONFIDENCE.slice(0, 3).includes(x["confidence"] as (typeof CONFIDENCE)[number])) {
          err(w, "bad confidence");
        }
        for (const c of Array.isArray(x["corroboratedBy"])
          ? (x["corroboratedBy"] as unknown[])
          : []) {
          if (!known(c)) err(w, `corroboratedBy ${String(c)} not in sources`);
        }
      }
      for (const s of Array.isArray(tox["sources"]) ? (tox["sources"] as unknown[]) : []) {
        if (!known(s)) err(at("toxicity"), `source ${String(s)} not in sources`);
      }
    }

    const links = e["links"];
    if (links !== undefined) {
      if (!Array.isArray(links)) err(at("links"), "links must be an array");
      else {
        const linkUrls = new Set<string>();
        for (const l of links as unknown[]) {
          if (!isObj(l)) {
            err(at("links"), "link is not an object");
            continue;
          }
          const u = typeof l["url"] === "string" ? l["url"] : "";
          const w = `${at("links")}.${u}`;
          if (!/^https:\/\/[^\s]+$/.test(u)) err(w, "link url must be https");
          else if (linkUrls.has(u)) err(w, "duplicate link url");
          else linkUrls.add(u);
          if (typeof l["lang"] !== "string" || !/^[a-z]{2,3}$/.test(l["lang"])) {
            err(w, "link needs lang, a base language such as en");
          }
          if (!LINK_KINDS.includes(l["kind"] as LinkKind))
            err(w, "link kind must be care, toxicity or botanical");
          for (const k of ["title", "publisher"]) {
            if (typeof l[k] !== "string" || l[k] === "") err(w, `link needs a ${k}`);
          }
        }
      }
    }

    const read = e["sourcesRead"];
    const readUrls = new Set<string>();
    if (!Array.isArray(read)) err(at("sourcesRead"), "entry needs a sourcesRead list");
    else {
      for (const u of read as unknown[]) {
        if (typeof u !== "string" || !/^https:\/\/[^\s]+$/.test(u) || readUrls.has(u)) {
          err(at("sourcesRead"), `sourcesRead url ${String(u)} must be a unique https url`);
        } else readUrls.add(u);
      }
    }
    for (const sid of cited) {
      if (kinds.get(sid) === "author_knowledge") continue;
      if (access.get(sid) !== "fetched") err(at("sourcesRead"), `source ${sid} was not fetched`);
      if (Array.isArray(read) && !readUrls.has(urls.get(sid) ?? "")) {
        err(at("sourcesRead"), `cited url of ${sid} is not in sourcesRead`);
      }
    }

    // optional fields. A missing `lookAlikes` means "not researched yet", not "none".
    const alikes = e["lookAlikes"];
    if (alikes !== undefined) {
      if (!Array.isArray(alikes)) err(at("lookAlikes"), "must be an array");
      else {
        for (const la of alikes as unknown[]) {
          const ok =
            isObj(la) &&
            typeof la["name"] === "string" &&
            la["name"].trim() !== "" &&
            typeof la["tell"] === "string" &&
            la["tell"].trim() !== "" &&
            (la["species"] === undefined ||
              (typeof la["species"] === "string" &&
                /^[a-z0-9]+(-[a-z0-9]+)*$/.test(la["species"])));
          if (!ok) err(at("lookAlikes"), "needs a name, a tell and (optionally) a species id slug");
        }
      }
    }
    const note = e["lookAlikeNote"];
    if (note !== undefined && (typeof note !== "string" || note.trim() === "")) {
      err(at("lookAlikeNote"), "must be non-empty text");
    }
    const ideas = e["nameIdeas"];
    if (ideas !== undefined) {
      const ok =
        Array.isArray(ideas) &&
        (ideas as unknown[]).every((x) => typeof x === "string" && x.trim() !== "");
      if (!ok) err(at("nameIdeas"), "must be an array of non-empty strings");
    }
    const photoFile = e["photoFile"];
    if (photoFile !== undefined && (typeof photoFile !== "string" || photoFile.trim() === "")) {
      err(at("photoFile"), "must be a Wikimedia Commons file name");
    }

    const photos: unknown[] = Array.isArray(e["photos"]) ? e["photos"] : [];
    for (const ph of photos) {
      const ok =
        isObj(ph) &&
        PHOTO_LICENCE.test(String(ph["licence"])) &&
        ["file", "creator", "licenceUrl", "sourceUrl"].every(
          (k) => typeof ph[k] === "string" && ph[k] !== "",
        ) &&
        /^[a-z0-9][a-z0-9-]*\.webp$/.test(String(ph["thumbnail"]));
      if (!ok)
        err(
          at("photos"),
          "photo needs an allowed licence, Commons file, creator, licenceUrl, sourceUrl and a bundled thumbnail",
        );
    }
  }
  return errors;
}

export interface Stats {
  readonly values: number;
  readonly checked: number;
  readonly fromKnowledge: number;
  readonly guess: number;
  readonly unknown: number;
  /** Non-null values whose main source and at least one other source agree. */
  readonly twoSources: number;
  readonly nonNullValues: number;
}

/** Counts values by confidence over care facts and toxicity exposures (for the pilot report). */
export function stats(files: readonly unknown[]): Stats {
  const s = {
    values: 0,
    checked: 0,
    fromKnowledge: 0,
    guess: 0,
    unknown: 0,
    twoSources: 0,
    nonNullValues: 0,
  };
  const add = (v: unknown): void => {
    if (!isObj(v) || !("confidence" in v)) return;
    s.values += 1;
    switch (v["confidence"]) {
      case "checked":
        s.checked += 1;
        break;
      case "from_knowledge_verify":
        s.fromKnowledge += 1;
        break;
      case "guess":
        s.guess += 1;
        break;
      default:
        s.unknown += 1;
    }
    if (v["confidence"] !== "unknown") {
      s.nonNullValues += 1;
      if (Array.isArray(v["corroboratedBy"]) && v["corroboratedBy"].length > 0) s.twoSources += 1;
    }
  };
  for (const f of files) {
    if (!isObj(f) || !Array.isArray(f["entries"])) continue;
    for (const e of f["entries"] as unknown[]) {
      if (!isObj(e)) continue;
      if (isObj(e["care"])) {
        Object.values(e["care"]).forEach(add);
        const est = e["care"]["establishment"];
        if (isObj(est)) Object.values(est).forEach(add);
      }
      const tox = e["toxicity"];
      if (isObj(tox) && Array.isArray(tox["exposures"]))
        (tox["exposures"] as unknown[]).forEach(add);
    }
  }
  return s;
}

/**
 * Warnings (not errors) for a catalogue file: an assessed entry with no `cat` or `dog` exposure was
 * graded for people only, so the app words pets as "not assessed". runs list these entries.
 */
export function petToxicityWarnings(file: unknown): string[] {
  const warnings: string[] = [];
  if (!isObj(file) || !Array.isArray(file["entries"])) return warnings;
  for (const e of file["entries"] as unknown[]) {
    if (!isObj(e) || !isObj(e["toxicity"]) || e["toxicity"]["status"] !== "assessed") continue;
    const exposures: unknown[] = Array.isArray(e["toxicity"]["exposures"])
      ? e["toxicity"]["exposures"]
      : [];
    if (!exposures.some((x) => isObj(x) && (x["who"] === "cat" || x["who"] === "dog")))
      warnings.push(
        `${String(e["id"])}.toxicity: assessed with no cat or dog exposure (pets not assessed)`,
      );
  }
  return warnings;
}
