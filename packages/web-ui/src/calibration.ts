// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Measure the water" section of the settings (C15): an optional, guided one-time measurement at
 * three levels (everywhere, one room, one plant). Quiet by design: no pop-up, badge or reminder.
 */
import { spaceView, type AppData } from "@green-garden/storage";
import { amountPrefs } from "./amount.ts";
import { esc, t, tHtml } from "./text.ts";

export function calibrationHtml(all: AppData): string {
  const data = spaceView(all);
  const measure = amountPrefs(data.settings).measure;
  const rooms = data.rooms
    .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
    .join("");
  const plants = data.plants
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join("");
  const value = (c: { factor?: number; measuredMl?: number }): string =>
    c.measuredMl !== undefined
      ? t("calibration.value.ml", { ml: c.measuredMl })
      : t("calibration.value.factor", { factor: c.factor ?? 1 });
  const items: { level: string; id: string; what: string; value: string }[] = [
    ...(data.settings.calibration === undefined
      ? []
      : [
          {
            level: "global",
            id: "",
            what: t("calibration.item.global"),
            value: value(data.settings.calibration),
          },
        ]),
    ...data.rooms.flatMap((r) =>
      r.calibration === undefined
        ? []
        : [
            {
              level: "room",
              id: r.id,
              what: t("calibration.item.room", { name: r.name }),
              value: value(r.calibration),
            },
          ],
    ),
    ...data.plants.flatMap((p) =>
      p.calibration === undefined
        ? []
        : [
            {
              level: "plant",
              id: p.id,
              what: t("calibration.item.plant", { name: p.name }),
              value: value(p.calibration),
            },
          ],
    ),
  ];
  const current =
    items.length === 0
      ? ""
      : `<h4>${esc(t("calibration.current"))}</h4><ul>${items
          .map(
            (i) =>
              `<li>${esc(i.what)}: ${esc(i.value)} <button type="button" data-action="reset-calibration" data-level="${i.level}" data-id="${esc(i.id)}" aria-label="${tHtml("calibration.ariaReset", { what: i.what })}">${esc(t("calibration.reset"))}</button></li>`,
          )
          .join("")}</ul>`;
  const unitContainer =
    measure === "none"
      ? ""
      : `<option value="container">${esc(t("calibration.unit.container", { unit: t(`amount.unit.${measure}`, { p: "other" }) }))}</option>`;
  return `<section id="calibration"><h3>${esc(t("calibration.heading"))}</h3>
    <p><small>${esc(t("calibration.intro"))}</small></p>
    <ol><li>${esc(t("calibration.step1"))}</li><li>${esc(t("calibration.step2"))}</li><li>${esc(t("calibration.step3"))}</li></ol>
    <form data-form="calibration">
      <label>${esc(t("calibration.level"))} <select name="level">
        <option value="global">${esc(t("calibration.level.global"))}</option>
        <option value="room">${esc(t("calibration.level.room"))}</option>
        <option value="plant">${esc(t("calibration.level.plant"))}</option></select></label>
      <label>${esc(t("calibration.room"))} <select name="roomId">${rooms}</select></label>
      <label>${esc(t("calibration.plant"))} <select name="plantId">${plants}</select></label>
      <label>${esc(t("calibration.amount"))} <input name="amount" type="number" min="0.1" step="any" autocomplete="off"></label>
      <label>${esc(t("calibration.unit"))} <select name="unit">${unitContainer}<option value="ml">${esc(t("calibration.unit.ml"))}</option></select></label>
      <button type="submit">${esc(t("calibration.save"))}</button>
    </form>${current}</section>`;
}
