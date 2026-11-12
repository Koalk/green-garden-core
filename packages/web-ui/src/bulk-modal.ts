// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser controller for the bulk-add dialog (01i section 8, B3). All rules live in bulk-flow.ts and all
 * markup in bulk-view.ts; this file keeps the state, wires events, loads photos and saves the draft.
 */
import { CommonsPhotos, type Fetcher } from "@green-garden/providers";
import { getLocale } from "@green-garden/i18n";
import { spaceView, type AppData } from "@green-garden/storage";
import {
  advance,
  bulkDraftText,
  gardenGate,
  goBack,
  makeMatcher,
  pickCandidate,
  removeRow,
  retype,
  runMatch,
  sameAsAbove,
  saveBulk,
  saveBulkDraft,
  setRowPlacement,
  setRowRoom,
  setText,
  setWatered,
  startBulk,
  toggleRow,
  useGeneric,
  type BulkState,
  type Matcher,
} from "./bulk-flow.ts";
import { bulkDialogHtml } from "./bulk-view.ts";
import type { ModalHost } from "./plant-modal.ts";
import type { PhotoInfo } from "./modal.ts";
import { SPECIES } from "./pilot-data.ts";
import { t } from "./text.ts";

const DRAFT_DELAY_MS = 600;

type Placement = "indoor" | "outdoor_pot" | "ground";
const PLACEMENTS: readonly Placement[] = ["indoor", "outdoor_pot", "ground"];

export function createBulkModal(host: ModalHost): { open(): void } {
  const fetcher: Fetcher = (url) => window.fetch(url);
  const commons = new CommonsPhotos(fetcher, window.localStorage);
  const photos = new Map<string, PhotoInfo>();
  let state: BulkState = startBulk();
  let restored = false;
  let gardenNote = false;
  let matcher: Matcher | undefined;
  let matcherLocale = "";
  let draftTimer: number | undefined;
  let pending: string | undefined;

  const dialog = (): HTMLDialogElement | null =>
    host.root.querySelector<HTMLDialogElement>("#bulk-modal");

  function currentMatcher(): Matcher {
    const locale = getLocale();
    if (matcher === undefined || matcherLocale !== locale) {
      matcher = makeMatcher(SPECIES, locale);
      matcherLocale = locale;
    }
    return matcher;
  }

  /** Keeps the typed text as the draft, so a reload or a cancel loses nothing. */
  function flushDraft(): void {
    window.clearTimeout(draftTimer);
    if (pending === undefined) return;
    const text = pending;
    pending = undefined;
    if (text === (bulkDraftText(host.data()) ?? "")) return;
    host.commit(saveBulkDraft(host.data(), text, host.today()), "");
  }

  function wantedPhotos(): void {
    if (state.step !== "match" && state.step !== "verify") return;
    const files = new Set<string>();
    for (const row of state.rows) {
      const ids = new Set([row.speciesId, ...row.candidates.map((c) => c.id)]);
      for (const id of ids) {
        const f = SPECIES.find((s) => s.id === id)?.photoFile;
        if (f !== undefined && !photos.has(f)) files.add(f);
      }
    }
    if (files.size === 0) return;
    void commons.get([...files]).then((got) => {
      let added = false;
      for (const [file, p] of got)
        if (!photos.has(file)) {
          photos.set(file, p);
          added = true;
        }
      if (added && dialog() !== null) draw();
    });
  }

  function draw(): void {
    const old = host.root.querySelector<HTMLElement>("#bulk-body");
    const scroll = old?.scrollTop ?? 0;
    const data: AppData = host.data();
    host.root.innerHTML = bulkDialogHtml(state, {
      rooms: spaceView(data).rooms,
      photos,
      data,
      today: host.today(),
      restored,
      gardenNote,
    });
    const d = dialog();
    if (d !== null && !d.open) d.showModal();
    const body = host.root.querySelector<HTMLElement>("#bulk-body");
    if (body !== null) body.scrollTop = scroll;
    wantedPhotos();
  }

  function setState(next: BulkState, opts: { focusTitle?: boolean } = {}): void {
    state = next;
    draw();
    if (opts.focusTitle === true) host.root.querySelector<HTMLElement>("#bulk-title")?.focus();
  }

  function close(): void {
    flushDraft();
    const d = dialog();
    if (d?.open === true) d.close();
    host.root.innerHTML = "";
  }

  function finish(): void {
    window.clearTimeout(draftTimer);
    pending = undefined;
    // Q-K0: an outdoor plant needs the garden question. Dismissing it keeps the dialog, list and choices.
    const gate = gardenGate(host.data(), state, host.today());
    if (gate.needed) {
      host.askHome((answered) => {
        if (dialog() === null) return;
        if (answered) {
          gardenNote = false;
          finish();
        } else {
          gardenNote = true;
          setState(gate.dismissed(state));
        }
      });
      return;
    }
    gardenNote = false;
    const res = saveBulk(host.data(), state, host.today());
    const message =
      res.notAdded === 0
        ? t("bulk.notice.saved", { n: res.saved })
        : t("bulk.notice.savedLeft", { n: res.saved, left: res.notAdded });
    const d = dialog();
    if (d?.open === true) d.close();
    host.root.innerHTML = "";
    host.commit(res.data, message);
  }

  const rowOf = (el: HTMLElement): string => el.dataset["row"] ?? "";

  host.root.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action^='bulk-']");
    if (el === null || dialog() === null) return;
    const row = rowOf(el);
    const value = el.dataset["value"];
    switch (el.dataset["action"]) {
      case "bulk-close":
        close();
        break;
      case "bulk-match": {
        flushDraft();
        const next = runMatch(state, currentMatcher());
        setState(next, { focusTitle: true });
        break;
      }
      case "bulk-next":
        setState(advance(state), { focusTitle: true });
        break;
      case "bulk-back":
        if (state.step === "match") restored = false;
        setState(goBack(state), { focusTitle: true });
        break;
      case "bulk-pick": {
        const id = el.dataset["species"];
        if (id !== undefined) setState(pickCandidate(state, row, id));
        break;
      }
      case "bulk-retype": {
        const input = host.root.querySelector<HTMLInputElement>(
          `input[name="retype"][data-row="${CSS.escape(row)}"]`,
        );
        if (input !== null) setState(retype(state, row, input.value, currentMatcher()));
        break;
      }
      case "bulk-generic":
        setState(useGeneric(state, row));
        break;
      case "bulk-remove":
        setState(removeRow(state, row));
        break;
      case "bulk-placement": {
        const p = PLACEMENTS.find((x) => x === value);
        if (p !== undefined) setState(setRowPlacement(state, row, p));
        break;
      }
      case "bulk-same":
        setState(sameAsAbove(state, row));
        break;
      case "bulk-room":
        setState(setRowRoom(state, row, value === "" ? undefined : value));
        break;
      case "bulk-watered":
        if (value === "today" || value === "unsure") setState(setWatered(state, value));
        break;
      case "bulk-save":
        finish();
        break;
    }
  });

  host.root.addEventListener("change", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset["action"] === "bulk-tick" && dialog() !== null) {
      setState(toggleRow(state, rowOf(el)));
    }
  });

  host.root.addEventListener("input", (ev) => {
    const el = ev.target as HTMLTextAreaElement;
    if (el.name !== "bulkText" || dialog() === null) return;
    state = setText(state, el.value);
    pending = el.value;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(flushDraft, DRAFT_DELAY_MS);
    // Only the count and the Match button change while typing; the text box keeps its caret.
    const redrawn = new DOMParser().parseFromString(
      bulkDialogHtml(state, {
        rooms: [],
        photos,
        data: host.data(),
        today: host.today(),
      }),
      "text/html",
    );
    const count = host.root.querySelector("#bulk-count");
    const fresh = redrawn.querySelector("#bulk-count");
    if (count !== null && fresh !== null) count.innerHTML = fresh.innerHTML;
    const next = host.root.querySelector<HTMLButtonElement>("[data-action='bulk-match']");
    if (next !== null)
      next.disabled =
        redrawn.querySelector("[data-action='bulk-match']")?.hasAttribute("disabled") ?? true;
  });

  host.root.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target as HTMLElement).matches("input[name='retype']")) {
      ev.preventDefault();
      (ev.target as HTMLElement)
        .closest(".retype")
        ?.querySelector<HTMLElement>("[data-action='bulk-retype']")
        ?.click();
    }
  });

  // Escape closes the dialog; the text is kept as the draft.
  // `cancel` does not bubble, so it is caught on the way down.
  host.root.addEventListener(
    "cancel",
    (ev) => {
      if (dialog() === null) return;
      ev.preventDefault();
      close();
    },
    true,
  );

  return {
    open(): void {
      const saved = bulkDraftText(host.data());
      restored = saved !== undefined;
      state = startBulk(saved ?? "");
      pending = undefined;
      gardenNote = false;
      draw();
      host.root.querySelector<HTMLTextAreaElement>("#bulk-text")?.focus();
    },
  };
}
