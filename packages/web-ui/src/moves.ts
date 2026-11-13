// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Bring inside" and "Put outside": the sheet's rules and markup. The move itself is the
 * engine's `recordMove`; this file only checks the date, applies the result to the app data and undoes it.
 */
import { formatDate, parseDate, placeInterval, recordMove } from "@green-garden/engine";
import { buildPlanInput, type AppData, type Plant } from "@green-garden/storage";
import { esc, t } from "./text.ts";

export type MoveTarget = "indoor" | "outdoor_pot";

/** Where a plant would go: the other of indoors and a pot outside. A ground plant cannot move. */
export function moveTarget(plant: Plant): MoveTarget | undefined {
  if (plant.placement === "ground") return undefined;
  return plant.placement === "outdoor_pot" ? "indoor" : "outdoor_pot";
}

/** An edit that changes indoors <-> a pot outside: it goes through the move sheet, not a silent flip. */
export function flipsPlace(old: Plant, edited: Pick<Plant, "placement">): boolean {
  return (
    old.placement !== "ground" &&
    edited.placement !== "ground" &&
    moveTarget(old) === (edited.placement === "outdoor_pot" ? "outdoor_pot" : "indoor")
  );
}

/**
 * The sheet's "what changes" line. With the engine's interval for the plant now and after the move
 * (learning restarts, so no adjustment) it says "water every 7 days instead of every 5"; otherwise the general line.
 */
export function moveEffectText(data: AppData, plant: Plant, today: string): string {
  const after = applyMove(data, plant.id, { on: today }, today);
  const from = placeInterval(buildPlanInput(data, today), plant.id);
  const to =
    after === undefined ? undefined : placeInterval(buildPlanInput(after, today), plant.id);
  if (from === undefined || to === undefined || from === to) return t("move.effect");
  return t("move.effectInterval", { from, to });
}

/** The dates the sheet accepts: today by default, never future, never before the previous entry. */
export function moveRange(
  plant: Pick<Plant, "placementHistory" | "addedOn">,
  today: string,
): { readonly min: string; readonly max: string } {
  const last = plant.placementHistory?.at(-1)?.on;
  const now = parseDate(today) ?? 0;
  return { min: last ?? plant.addedOn ?? formatDate(now - 365), max: today };
}

export interface MoveChoice {
  readonly on: string;
  /** Put outside only: under cover. */
  readonly sheltered?: boolean;
  /** Bring inside only, when the plant has no remembered room. */
  readonly roomId?: string;
}

/** The data after the move, or undefined for a ground plant, an unknown plant or a date the engine refuses. */
export function applyMove(
  data: AppData,
  plantId: string,
  choice: MoveChoice,
  today: string,
): AppData | undefined {
  const plant = data.plants.find((p) => p.id === plantId);
  const target = plant === undefined ? undefined : moveTarget(plant);
  if (plant === undefined || target === undefined) return undefined;
  const range = moveRange(plant, today);
  if (choice.on < range.min || choice.on > range.max) return undefined;
  const r = recordMove(
    plant,
    {
      on: choice.on,
      placement: target,
      ...(target === "outdoor_pot" ? { sheltered: choice.sheltered === true } : {}),
    },
    today,
  );
  if (!r.ok) return undefined;
  const rest = Object.fromEntries(
    Object.entries(plant).filter(([k]) => k !== "placement"),
  ) as unknown as Plant;
  const moved: Plant = {
    ...rest,
    placementHistory: r.placementHistory,
    ...(r.placement === "outdoor_pot" ? { placement: "outdoor_pot" as const } : {}),
    ...(r.sheltered === undefined ? {} : { sheltered: r.sheltered }),
    ...(target === "indoor" && choice.roomId !== undefined && plant.roomId === undefined
      ? { roomId: choice.roomId }
      : {}),
  };
  return { ...data, plants: data.plants.map((p) => (p.id === plantId ? moved : p)) };
}

/** Puts the plant as it was before the move back (the 10 seconds of undo). */
export function undoMove(data: AppData, before: Plant): AppData {
  return { ...data, plants: data.plants.map((p) => (p.id === before.id ? before : p)) };
}

/** The sheet: date, Open/Under cover when going outside, a room when going in and none is remembered. */
export function moveSheetHtml(
  plant: Plant,
  today: string,
  rooms: readonly { readonly id: string; readonly name: string }[],
  effect: string = t("move.effect"),
): string {
  const target = moveTarget(plant);
  if (target === undefined) return "";
  const range = moveRange(plant, today);
  const cover =
    target === "outdoor_pot"
      ? `<fieldset><legend>${esc(t("move.cover.legend"))}</legend>
        <label><input type="radio" name="sheltered" value="0" checked> ${esc(t("move.cover.open"))}</label>
        <label><input type="radio" name="sheltered" value="1"> ${esc(t("move.cover.covered"))}</label></fieldset>`
      : "";
  const room =
    target === "indoor" && plant.roomId === undefined
      ? `<label>${esc(t("move.room"))} <select name="roomId"><option value=""></option>${rooms
          .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
          .join("")}</select></label>`
      : "";
  return `<form data-form="move" data-id="${esc(plant.id)}"><h4>${esc(t(target === "indoor" ? "move.bringIn" : "move.putOut"))}: ${esc(plant.name)}</h4>
    <label>${esc(t("move.date"))}
      <input type="date" name="date" autocomplete="off" required value="${esc(range.max)}" min="${esc(range.min)}" max="${esc(range.max)}"></label>
    ${cover}${room}
    <p><small>${esc(effect)}</small></p>
    <button type="submit">${esc(t("move.submit"))}</button>
    <button type="button" data-action="move-cancel">${esc(t("move.cancel"))}</button></form>`;
}
