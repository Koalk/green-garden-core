// SPDX-License-Identifier: AGPL-3.0-only

/** Importing rooms from Home Assistant areas: the pure parts, the checklist and the wording. */
import type { Area, AreaFailure } from "@green-garden/providers";
import { spaceView, type AppData } from "@green-garden/storage";
import { nextId } from "./actions.ts";
import { activeSpaceId } from "@green-garden/storage";
import { esc, t } from "./text.ts";

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Adds a room for each chosen area that is not a room yet in the active space (names compared without
 * regard to case). A room of the same name that has no area id yet is linked to the area instead
 *; one that already has an area id is left alone. Never deletes or renames a room; returns
 * `data` itself when nothing changes.
 */
export function importRooms(
  data: AppData,
  areas: readonly Area[],
  chosen: readonly string[],
): AppData {
  const space = activeSpaceId(data);
  const inSpace = new Set(spaceView(data).rooms.map((r) => r.id));
  const rooms = [...data.rooms];
  let changed = false;
  for (const id of new Set(chosen)) {
    const area = areas.find((a) => a.id === id);
    if (area === undefined) continue;
    const at = rooms.findIndex((r) => inSpace.has(r.id) && same(r.name, area.name));
    const found = rooms[at];
    if (found !== undefined) {
      if (found.haAreaId === undefined) {
        rooms[at] = { ...found, haAreaId: area.id };
        changed = true;
      }
      continue;
    }
    const roomId = nextId(
      rooms.map((r) => r.id),
      "r",
    );
    rooms.push({ id: roomId, name: area.name, spaceId: space, haAreaId: area.id });
    inSpace.add(roomId);
    changed = true;
  }
  return changed ? { ...data, rooms } : data;
}

/** The pick list: every area, the ones that are rooms already shown ticked-off and disabled. */
export function areaChecklistHtml(areas: readonly Area[], data: AppData): string {
  if (areas.length === 0) return `<p>${esc(t("ha.noAreas"))}</p>`;
  const have = spaceView(data).rooms;
  const items = areas
    .map((a) => {
      const room = have.find((r) => same(r.name, a.name));
      const done = room !== undefined && room.haAreaId !== undefined;
      const note =
        room === undefined
          ? ""
          : ` <small>(${esc(t(done ? "ha.alreadyRoom" : "ha.linkRoom"))})</small>`;
      return `<li><label><input type="checkbox" name="area" value="${esc(a.id)}"${done ? " disabled" : " checked"}> ${esc(a.name)}${note}</label></li>`;
    })
    .join("");
  return `<form data-form="ha-rooms"><p>${esc(t("ha.pick"))}</p><ul>${items}</ul>
    <button type="submit">${esc(t("ha.import"))}</button></form>`;
}

/** Why the import did not work, in words that say what to do. */
export function haFailureText(reason: AreaFailure): string {
  return t(`ha.err.${reason}`);
}
