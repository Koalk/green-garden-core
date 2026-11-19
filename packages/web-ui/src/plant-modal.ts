// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser controller for the full-screen add-plant dialog. All markup comes from modal.ts and all
 * rules from drafts.ts, species.ts and names.ts; this file only wires events, the network and the DOM.
 * PROVISIONAL: behaviour is the simplest that works, not a design decision.
 */
import {
  CommonsPhotos,
  openPlantbookDetail,
  openPlantbookSearch,
  type Fetcher,
} from "@green-garden/providers";
import { spaceView, type AppData, type Plant } from "@green-garden/storage";
import { addPlant, updatePlant } from "./actions.ts";
import {
  deleteDraft,
  draftFields,
  hasUnsavedChanges,
  plantFromFields,
  saveDraft,
  plantFieldIssues,
} from "./drafts.ts";
import {
  careDetailsHtml,
  modalHtml,
  resultsHtml,
  speciesPanelHtml,
  type Hit,
  type PhotoInfo,
  type Selected,
} from "./modal.ts";
import { nextName } from "./names.ts";
import { withCatalogueOutdoor } from "./outdoor.ts";
import { amountNoteFor } from "./amount.ts";
import {
  defaultPlacementFor,
  nameAfterPick,
  placementAfterAsk,
  placementNeedsHome,
} from "./placement.ts";
import { flipsPlace } from "./moves.ts";
import { parseRanges, presetRanges, serialiseRanges, sunRowHtml } from "./sun-hours.ts";
import { esc, t } from "./text.ts";
import { SPECIES, type SpeciesRow } from "./pilot-data.ts";
import { careFill, normalise, searchSpecies } from "./species.ts";
import { nextActive, SearchSession } from "./search-nav.ts";

type Fields = Record<string, string>;

/** What the modal needs from the app shell. */
export interface ModalHost {
  readonly root: HTMLElement;
  data(): AppData;
  today(): string;
  /** Replaces the app data (and saves, and re-renders the page behind the dialog). */
  commit(next: AppData, message: string): void;
  /** Opens Q-K0; `done(true)` once the home is saved, `done(false)` on "Not now" or Escape. */
  askHome(done: (answered: boolean) => void): void;
  /** Opens the move sheet for a plant (an edit that flips indoors and pot outside). */
  openMove?(plantId: string): void;
}

const SEARCH_DELAY_MS = 300;

function asFields(plant: Plant): Fields {
  const f: Fields = {
    plantName: plant.name,
    style: plant.style,
    intervalDays: String(plant.intervalDays),
  };
  const opt: Record<string, string | number | undefined> = {
    species: plant.species,
    roomId: plant.roomId,
    lastWatered: plant.lastWatered,
    addedOn: plant.addedOn,
    addedOnEstimated: plant.addedOnEstimated === true ? "1" : undefined,
    potDiameterCm: plant.potDiameterCm,
    potHeightCm: plant.potHeightCm,
    drainage: plant.drainage,
    restFactor: plant.restFactor,
    dryTolDays: plant.dryTolDays,
    wetTolDays: plant.wetTolDays,
    source: plant.source,
    placement: plant.placement,
    sheltered: plant.sheltered === undefined ? undefined : plant.sheltered ? "1" : "0",
    directSun: plant.directSun === undefined ? undefined : serialiseRanges(plant.directSun),
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) f[k] = String(v);
  return f;
}

function speciesByName(name: string | undefined): SpeciesRow | undefined {
  const q = normalise(name ?? "");
  return q === ""
    ? undefined
    : SPECIES.find((r) => normalise(r.scientificName) === q || normalise(r.name) === q);
}

/** The edited plant with the place it had before; the move then changes it with a date. */
function keepPlace(plant: Omit<Plant, "id" | "spaceId">, old: Plant): Plant {
  const rest = Object.fromEntries(Object.entries(plant).filter(([k]) => k !== "placement"));
  return {
    ...rest,
    id: old.id,
    ...(old.placement === undefined ? {} : { placement: old.placement }),
  } as Plant;
}

export function createPlantModal(host: ModalHost): {
  open(fields?: Fields, opts?: { plantId?: string; draftId?: string; title?: string }): void;
  openPlant(plantId: string): void;
  openDraft(draftId: string): void;
} {
  const fetcher: Fetcher = (url) => window.fetch(url);
  const commons = new CommonsPhotos(fetcher, window.localStorage);
  const photos = new Map<string, PhotoInfo>();
  /** Names handed out by Randomise this session, lower case: a name is never offered twice. */
  const usedNames = new Set<string>();

  let initial: Fields = {};
  let selected: Selected | undefined;
  let plantId: string | undefined;
  let draftId: string | undefined;
  let hits: Hit[] = [];
  let query = "";
  let seq = 0;
  const session = new SearchSession();
  /** Index of the highlighted suggestion (-1: none); focus stays in the search box. */
  let active = -1;
  let timer: number | undefined;

  const dialog = (): HTMLDialogElement | null =>
    host.root.querySelector<HTMLDialogElement>("#plant-modal");
  const part = (id: string): HTMLElement | null => host.root.querySelector<HTMLElement>(`#${id}`);
  const form = (): HTMLFormElement | null =>
    host.root.querySelector<HTMLFormElement>("#plant-form");

  function current(): Fields {
    const f = form();
    const out: Fields = {};
    if (f === null) return out;
    for (const [k, v] of new FormData(f)) {
      if (typeof v === "string" && k !== "speciesSearch") out[k] = v;
    }
    return out;
  }

  /** The cover and sun rows are for plants outside. */
  function outdoorRowsFor(value: string): void {
    for (const row of host.root.querySelectorAll("fieldset.cover, fieldset.sun-row")) {
      if (row instanceof HTMLElement) row.hidden = value === "indoor";
    }
  }

  /** Shows `value` on the placement chips and in the hidden field the form saves. */
  function showPlacement(value: string): void {
    setField("placement", value);
    outdoorRowsFor(value);
    for (const b of host.root.querySelectorAll<HTMLElement>('[data-action="placement-chip"]'))
      b.setAttribute("aria-pressed", String(b.dataset["value"] === value));
  }

  /** Redraws the Direct sun row for new hours text. */
  function setSun(value: string): void {
    const row = host.root.querySelector<HTMLElement>("fieldset.sun-row");
    if (row === null) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = sunRowHtml(value, row.hidden === true);
    const fresh = wrap.firstElementChild;
    if (fresh !== null) row.replaceWith(fresh);
  }

  /**
   * An outdoor placement with no climate set asks Q-K0 first (the shared gate rule); "Not now" or Escape
   * keeps the chip on where it was.
   */
  function choosePlacement(value: string): void {
    const before = current()["placement"] ?? "indoor";
    showPlacement(value);
    if (!placementNeedsHome(host.data(), value)) return;
    host.askHome((answered) => {
      if (!answered) showPlacement(placementAfterAsk(before, value, answered));
    });
  }

  function setField(name: string, value: string): void {
    const el = form()?.elements.namedItem(name);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
  }

  /** Loads any Commons photos the visible species need, then redraws the parts that show them. */
  function loadPhotos(): void {
    const files: string[] = [];
    const want = (r: SpeciesRow | undefined): void => {
      if (r?.photoFile !== undefined && !photos.has(r.photoFile)) files.push(r.photoFile);
    };
    for (const h of hits) if (h.kind === "catalogue") want(h.row);
    if (selected?.kind === "catalogue") {
      want(selected.row);
      for (const l of selected.row.lookAlikes ?? []) want(SPECIES.find((s) => s.id === l.species));
    }
    if (files.length === 0) return;
    void commons.get(files).then((got) => {
      let added = false;
      for (const [file, p] of got)
        if (!photos.has(file)) {
          photos.set(file, p);
          added = true;
        }
      if (added) {
        drawResults();
        drawPanel();
      }
    });
  }

  function drawResults(): void {
    const box = part("species-results");
    if (box === null) return;
    box.innerHTML = resultsHtml(hits, photos, query);
    const input = form()?.querySelector('[name="speciesSearch"]');
    input?.setAttribute("aria-expanded", String(hits.length > 0));
    paintActive();
  }

  /** Marks the highlighted option and points `aria-activedescendant` at it. */
  function paintActive(): void {
    const input = form()?.querySelector('[name="speciesSearch"]');
    const opts = [...host.root.querySelectorAll<HTMLElement>('#species-results [role="option"]')];
    if (active >= opts.length) active = -1;
    opts.forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === active));
      o.classList.toggle("active", i === active);
    });
    const cur = opts[active];
    if (cur === undefined) input?.removeAttribute("aria-activedescendant");
    else {
      input?.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    }
  }

  function drawPanel(): void {
    const box = part("species-panel");
    if (box !== null) box.innerHTML = speciesPanelHtml(selected, SPECIES, photos);
  }

  function drawCare(values: Fields, open: boolean): void {
    const box = part("care-details");
    if (box === null) return;
    const row = selected?.kind === "catalogue" ? selected.row : undefined;
    box.innerHTML = careDetailsHtml(values, {
      open,
      ...(row === undefined ? {} : { from: row.name, species: row }),
    });
  }

  function open(
    fields: Fields = {},
    opts: { plantId?: string; draftId?: string; title?: string } = {},
  ): void {
    plantId = opts.plantId;
    draftId = opts.draftId;
    hits = [];
    query = "";
    const row = speciesByName(fields["species"]);
    const typed = (fields["species"] ?? "").trim();
    selected =
      row !== undefined
        ? { kind: "catalogue", row }
        : typed !== ""
          ? { kind: "text", text: typed }
          : undefined;
    const known = row !== undefined;
    const editing =
      plantId === undefined ? undefined : host.data().plants.find((p) => p.id === plantId);
    const amountNote = amountNoteFor(host.data(), editing);
    host.root.innerHTML = modalHtml({
      fields,
      rooms: spaceView(host.data()).rooms,
      title: opts.title ?? t("modal.add"),
      ...(plantId === undefined ? {} : { plantId }),
      ...(draftId === undefined ? {} : { draftId }),
      panel: speciesPanelHtml(selected, SPECIES, photos),
      ...(amountNote === undefined ? {} : { amountNote }),
      care: careDetailsHtml(fields, {
        open: !known,
        ...(row === undefined ? {} : { from: row.name, species: row }),
      }),
    });
    initial = current();
    dialog()?.showModal();
    loadPhotos();
  }

  function close(): void {
    window.clearTimeout(timer);
    seq += 1;
    session.close();
    const d = dialog();
    if (d?.open === true) d.close();
    host.root.innerHTML = "";
  }

  function requestClose(): void {
    if (hasUnsavedChanges(initial, current())) {
      const box = part("close-prompt");
      if (box !== null) {
        box.innerHTML = `<p>${esc(t("modal.unsaved"))}
          <button type="button" data-action="prompt-draft">${esc(t("modal.keepDraft"))}</button>
          <button type="button" data-action="prompt-discard">${esc(t("modal.discard"))}</button>
          <button type="button" data-action="prompt-back">${esc(t("modal.keepEditing"))}</button></p>`;
        box.querySelector<HTMLElement>("button")?.focus();
      }
    } else close();
  }

  function saveAsDraft(): void {
    host.commit(
      saveDraft(host.data(), current(), host.today(), draftId, plantId),
      t("notice.draftSaved"),
    );
    close();
  }

  /** The name the last catalogue pick filled in, so a later pick may replace it. */
  let autoName: string | undefined;

  function pickCatalogue(id: string): void {
    const row = SPECIES.find((r) => r.id === id);
    if (row === undefined) return;
    selected = { kind: "catalogue", row };
    const fill = careFill(row);
    const values: Fields = { ...current(), species: row.scientificName, source: fill.source };
    for (const k of ["style", "intervalDays", "restFactor", "dryTolDays", "wetTolDays"] as const) {
      const v = fill[k];
      if (v !== undefined) values[k] = String(v);
      else Reflect.deleteProperty(values, k);
    }
    const named = nameAfterPick(values["plantName"] ?? "", autoName, row.name);
    autoName = named.auto;
    if (named.name !== (values["plantName"] ?? "")) setField("plantName", named.name);
    // A new plant starts on the entry's own placement; a saved plant keeps where it lives.
    if (plantId === undefined) choosePlacement(defaultPlacementFor(row));
    setField("species", row.scientificName);
    clearSearch();
    drawPanel();
    drawCare(values, false);
    loadPhotos();
  }

  function pickOpb(pid: string, name: string): void {
    const mine = ++seq;
    selected = { kind: "opb", pid, name };
    setField("species", name);
    clearSearch();
    drawPanel();
    drawCare({ ...current(), source: "OpenPlantbook (no watering advice)" }, true);
    void openPlantbookDetail(pid, fetcher).then((d) => {
      if (d === undefined || mine !== seq || selected?.kind !== "opb") return;
      selected = {
        kind: "opb",
        pid,
        name,
        ...(d.category === undefined ? {} : { category: d.category }),
        ...(d.imageUrl === undefined ? {} : { imageUrl: d.imageUrl }),
        imageRights: d.imageRights,
      };
      drawPanel();
    });
  }

  function clearSearch(): void {
    window.clearTimeout(timer);
    session.close();
    active = -1;
    hits = [];
    query = "";
    setField("speciesSearch", "");
    drawResults();
  }

  function search(text: string): void {
    window.clearTimeout(timer);
    const mine = session.begin();
    active = -1;
    query = text;
    hits = searchSpecies(text, SPECIES).map((row) => ({ kind: "catalogue", row }));
    drawResults();
    loadPhotos();
    if (text.trim().length < 2) return;
    timer = window.setTimeout(() => {
      void openPlantbookSearch(text, fetcher).then((found) => {
        if (!session.isCurrent(mine)) return;
        const have = new Set(
          hits.map((h) => (h.kind === "catalogue" ? normalise(h.row.scientificName) : "")),
        );
        const extra: Hit[] = found
          .filter((f) => !have.has(normalise(f.name)))
          .map((f) => ({
            kind: "opb",
            pid: f.pid,
            name: f.name,
            ...(f.category === undefined ? {} : { category: f.category }),
          }));
        if (extra.length === 0) return;
        hits = [...hits, ...extra];
        drawResults();
      });
    }, SEARCH_DELAY_MS);
  }

  function save(): void {
    const fields = current();
    const issues = plantFieldIssues(fields);
    const errors = issues.map((k) => t(k));
    const box = part("modal-errors");
    if (errors.length > 0) {
      if (box !== null) box.textContent = errors.join(" ");
      const care = host.root.querySelector<HTMLDetailsElement>("#care-details details");
      if (care !== null && issues.some((k) => k !== "error.name")) care.open = true;
      return;
    }
    const data = host.data();
    const old = plantId === undefined ? undefined : data.plants.find((p) => p.id === plantId);
    const plant = withCatalogueOutdoor(
      plantFromFields(fields, old),
      selected?.kind === "catalogue" ? selected.row : undefined,
    );
    // An edit that flips indoors <-> pot outside is a dated move: the other fields save now, the place
    // stays as it was, and the move sheet opens for the date (the history and the learning restart).
    const flips = old !== undefined && flipsPlace(old, plant);
    const next =
      old === undefined
        ? addPlant(data, plant, host.today())
        : updatePlant(data, flips ? keepPlace(plant, old) : { ...plant, id: old.id });
    host.commit(
      draftId === undefined ? next : deleteDraft(next, draftId),
      old === undefined ? t("notice.plantAdded") : t("notice.plantSaved"),
    );
    close();
    if (flips) host.openMove?.(plantId ?? "");
  }

  function randomise(): void {
    const used = new Set([
      ...usedNames,
      ...spaceView(host.data()).plants.map((p) => p.name.toLowerCase()),
    ]);
    const name = nextName(
      selected?.kind === "catalogue" ? selected.row : undefined,
      used,
      Math.random,
    );
    usedNames.add(name.toLowerCase());
    setField("plantName", name);
  }

  function moveActive(step: 1 | -1): void {
    active = nextActive(active, step, hits.length);
    paintActive();
  }

  host.root.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (el === null) return;
    const { action, id, kind, name, text } = el.dataset;
    switch (action) {
      case "modal-close":
        requestClose();
        break;
      case "save-draft":
      case "prompt-draft":
        saveAsDraft();
        break;
      case "prompt-discard":
        close();
        break;
      case "prompt-back": {
        const box = part("close-prompt");
        if (box !== null) box.innerHTML = "";
        break;
      }
      case "cover-chip": {
        const covered = el.dataset["value"] === "covered";
        setField("sheltered", covered ? "1" : "0");
        for (const b of host.root.querySelectorAll<HTMLElement>('[data-action="cover-chip"]'))
          b.setAttribute("aria-pressed", String(b === el));
        break;
      }
      case "sun-add-toggle": {
        const panel = host.root.querySelector<HTMLElement>(".sun-add");
        if (panel !== null) panel.hidden = !panel.hidden;
        break;
      }
      case "sun-preset": {
        const r = presetRanges(el.dataset["value"] ?? "");
        setSun(r === undefined ? "" : serialiseRanges(r));
        break;
      }
      case "sun-remove": {
        const i = Number(el.dataset["index"]);
        const kept = (parseRanges(current()["directSun"] ?? "") ?? []).filter((_, k) => k !== i);
        setSun(kept.length === 0 ? "" : serialiseRanges(kept));
        break;
      }
      case "sun-add": {
        const num = (k: string): number =>
          Number(host.root.querySelector<HTMLInputElement>(`[data-sun="${k}"]`)?.value);
        const have = parseRanges(current()["directSun"] ?? "") ?? [];
        const next = [...have, { from: num("from"), to: num("to") }].sort(
          (a, b) => a.from - b.from,
        );
        const text = serialiseRanges(next);
        if (parseRanges(text) !== undefined) setSun(text);
        break;
      }
      case "placement-chip":
        if (el.dataset["value"] !== undefined) choosePlacement(el.dataset["value"]);
        break;
      case "randomise":
        randomise();
        break;
      case "pot-chip": {
        const cm = el.dataset["cm"];
        if (cm !== undefined) {
          setField("potDiameterCm", cm);
          for (const b of host.root.querySelectorAll<HTMLElement>('[data-action="pot-chip"]')) {
            b.setAttribute("aria-pressed", String(b.dataset["cm"] === cm));
          }
        }
        break;
      }
      case "use-text":
        if (text !== undefined) {
          selected = { kind: "text", text };
          setField("species", text);
          clearSearch();
          drawPanel();
          drawCare(current(), true);
        }
        break;
      case "pick":
        if (id === undefined) break;
        if (kind === "opb") pickOpb(id, name ?? id);
        else pickCatalogue(id);
        break;
    }
  });

  host.root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === "speciesSearch") search(t.value);
  });

  host.root.addEventListener("submit", (ev) => {
    ev.preventDefault();
    save();
  });

  host.root.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLInputElement;
    if (target.name !== "speciesSearch") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      moveActive(ev.key === "ArrowDown" ? 1 : -1);
    } else if (ev.key === "Enter") {
      // Enter takes the highlighted suggestion (the top one when none is highlighted) instead of submitting.
      ev.preventDefault();
      const chosen = hits[active >= 0 ? active : 0];
      if (chosen?.kind === "catalogue") pickCatalogue(chosen.row.id);
      else if (chosen?.kind === "opb") pickOpb(chosen.pid, chosen.name);
    }
  });

  // `cancel` (Esc) does not bubble, so listen in the capture phase.
  host.root.addEventListener(
    "cancel",
    (ev) => {
      ev.preventDefault();
      if (hits.length > 0) {
        clearSearch();
        form()?.querySelector<HTMLElement>('[name="speciesSearch"]')?.focus();
      } else requestClose();
    },
    true,
  );

  // The bundled thumbnail shows at once; when its sharper Commons copy loads (online), it replaces it.
  // A failed full photo changes nothing: the thumbnail stays. The browser caches the copy for next time.
  host.root.addEventListener(
    "load",
    (ev) => {
      const img = ev.target;
      if (!(img instanceof HTMLImageElement)) return;
      const full = img.dataset["full"];
      if (full === undefined || img.dataset["fullTried"] !== undefined) return;
      img.dataset["fullTried"] = "1";
      const probe = new Image();
      probe.onload = () => {
        img.src = full;
      };
      probe.src = full;
    },
    true,
  );

  // A photo that fails to load becomes a plain placeholder.
  host.root.addEventListener(
    "error",
    (ev) => {
      const img = ev.target;
      if (img instanceof HTMLImageElement) {
        const ph = document.createElement("span");
        ph.className = "photo ph";
        ph.textContent = t("modal.noPhoto");
        img.closest("figure")?.replaceWith(ph);
      }
    },
    true,
  );

  return {
    open,
    openPlant(id) {
      const p = host.data().plants.find((x) => x.id === id);
      if (p !== undefined)
        open(asFields(p), { plantId: id, title: t("modal.edit", { name: p.name }) });
    },
    openDraft(id) {
      const d = (host.data().drafts ?? []).find((x) => x.id === id);
      if (d === undefined) return;
      const title = t(d.plantId === undefined ? "modal.addDraft" : "modal.editDraft");
      open(
        { ...draftFields(host.data(), id) },
        {
          draftId: id,
          title,
          ...(d.plantId === undefined ? {} : { plantId: d.plantId }),
        },
      );
    },
  };
}
