// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rain sources and what each one's terms allow (02k 10 and 11). `commercialUse` lets the
 * Stories row gate on it: `confirmed` (terms read, commercial reuse allowed with attribution), `pending`
 * (terms point both ways, a written answer is awaited) or `no` (free tier for non-commercial use only).
 * `built` says whether an adapter exists yet.
 */
export interface RainSource {
  readonly id: "open-meteo" | "environment-agency" | "aemet" | "sepa";
  readonly kind: "model" | "gauge";
  readonly region: string;
  readonly licenceId: string;
  readonly commercialUse: "confirmed" | "pending" | "no";
  readonly needsKey: boolean;
  readonly built: boolean;
  readonly attribution: string;
}

export const RAIN_SOURCES: readonly RainSource[] = [
  {
    id: "open-meteo",
    kind: "model",
    region: "worldwide",
    licenceId: "CC-BY-4.0",
    commercialUse: "no",
    needsKey: false,
    built: true,
    attribution: "Weather data by Open-Meteo.com",
  },
  {
    id: "environment-agency",
    kind: "gauge",
    region: "England",
    licenceId: "OGL-UK-3.0",
    commercialUse: "confirmed",
    needsKey: false,
    built: true,
    attribution: "This uses Environment Agency rainfall data from the real-time data API (Beta)",
  },
  {
    id: "aemet",
    kind: "gauge",
    region: "Spain, including the islands",
    licenceId: "AEMET-reuse",
    commercialUse: "confirmed",
    needsKey: true,
    built: true,
    attribution: "© AEMET",
  },
  {
    id: "sepa",
    kind: "gauge",
    region: "Scotland",
    licenceId: "OGL-UK-3.0",
    commercialUse: "pending",
    needsKey: false,
    built: true,
    attribution:
      "Contains SEPA data © Scottish Environment Protection Agency and database right <year>. All rights reserved",
  },
];
