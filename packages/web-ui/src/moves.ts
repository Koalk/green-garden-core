// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Bring inside" and "Put outside" (02m 1.5): the sheet's rules and markup. The move itself is the
 * engine's `recordMove`; this file only checks the date, applies the result to the app data and undoes it.
 */
import { formatDate, parseDate, recordMove } from "@green-garden/engine";
import type { AppData, Plant } from "@green-garden/storage";
import { esc, t } from "./text.ts";

export type MoveTarget = "indoor" | "outdoor_pot";

/** Where a plant would go: the other of indoors and a pot outside. A ground plant cannot move (02m 1.7). */
export function moveTarget(plant: Plant): MoveTarget | undefined {
  if (plant.placement === "ground") return undefined;
  return plant.placement === "outdoor_pot" ? "indoor" : "outdoor_pot";
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
    <p><small>${esc(t("move.effect"))}</small></p>
    <button type="submit">${esc(t("move.submit"))}</button>
    <button type="button" data-action="move-cancel">${esc(t("move.cancel"))}</button></form>`;
}
