// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  directSunHours,
  resolveCare,
  startMultipliers,
  type PlantInput,
  type SunRange,
} from "@green-garden/engine";

// (clip to daylight, no sun-height weighting). Constants PROVISIONAL.

const near = (a: number, b: number, eps = 0.05): void => {
  assert.ok(Math.abs(a - b) <= eps, `${String(a)} is not within ${String(eps)} of ${String(b)}`);
};

const morning: SunRange[] = [{ from: 7, to: 11 }];
const edinburgh = { hemisphere: "north", latitude: 55, country: "GB" } as const;

describe("directSunHours: ranges clipped to daylight", () => {
  it("gives the full range when the sun is up the whole time (June, 55 N)", () => {
    near(directSunHours(morning, "2026-06-21", edinburgh), 4);
  });

  it("December hours are shorter than June for the same Morning answer at Edinburgh", () => {
    const dec = directSunHours(morning, "2026-12-21", edinburgh);
    const jun = directSunHours(morning, "2026-06-21", edinburgh);
    assert.ok(dec < jun - 1.5, `${String(dec)} vs ${String(jun)}`);
    assert.ok(dec > 1 && dec < 3, String(dec));
  });

  it("clips to sunrise and sunset in June and December at 55 and 40 N", () => {
    const all: SunRange[] = [{ from: 0, to: 24 }];
    near(directSunHours(all, "2026-06-21", edinburgh), 17.1, 0.3);
    near(directSunHours(all, "2026-12-21", edinburgh), 6.9, 0.3);
    const spain = { hemisphere: "north", latitude: 40, country: "ES" } as const;
    near(directSunHours(all, "2026-06-21", spain), 14.8, 0.3);
    near(directSunHours(all, "2026-12-21", spain), 9.2, 0.3);
  });

  it("is 0, 3, 6 and 9 hours for ranges of that length at midday (June, 40 N)", () => {
    const spain = { hemisphere: "north", latitude: 40 } as const;
    for (const h of [0, 3, 6, 9]) {
      const from = 12 - h / 2;
      const r: SunRange[] = h === 0 ? [] : [{ from, to: 12 + h / 2 }];
      near(directSunHours(r, "2026-06-21", spain), h);
    }
  });

  it("adds ranges up and treats an empty list as no direct sun", () => {
    const two: SunRange[] = [
      { from: 7, to: 11 },
      { from: 15, to: 18 },
    ];
    near(directSunHours(two, "2026-06-21", edinburgh), 7);
    assert.equal(directSunHours([], "2026-06-21", edinburgh), 0);
  });

  it("is the same in the southern hemisphere half a year apart", () => {
    const all: SunRange[] = [{ from: 0, to: 24 }];
    const south = { hemisphere: "south", latitude: 55 } as const;
    near(directSunHours(all, "2026-12-21", south), 17.1, 0.3);
    near(directSunHours(all, "2026-06-21", south), 6.9, 0.3);
  });

  it("falls back to the hemisphere's default latitude when none is given", () => {
    const all: SunRange[] = [{ from: 0, to: 24 }];
    near(directSunHours(all, "2026-06-21", { hemisphere: "north" }), 17.1, 0.3);
  });
});

const pot: PlantInput = {
  id: "pot",
  style: "let_top_dry",
  intervalDays: 10,
  placement: "outdoor_pot",
  sun: "part_shade",
  sheltered: false,
};

const env = { hemisphere: "north", latitude: 55, climate: "oceanic_wet" } as const;

describe("hours to the outdoor factor", () => {
  it("a pot with 4 hours in June gets 6 days where the part_shade class gave 7", () => {
    assert.equal(resolveCare(pot, "2026-06-21", env).intervalDays, 7);
    const withHours = { ...pot, directSun: morning };
    assert.equal(resolveCare(withHours, "2026-06-21", env).intervalDays, 6);
  });

  it("hours win over the class (full_sun class, shade-side hours)", () => {
    const p: PlantInput = { ...pot, sun: "full_sun", directSun: [] };
    assert.equal(resolveCare(p, "2026-06-21", env).intervalDays, 9); // 10 x 0.85
  });

  it("an empty list is no direct sun: the shade side", () => {
    assert.equal(resolveCare({ ...pot, directSun: [] }, "2026-06-21", env).intervalDays, 9);
  });

  it("6 hours or more is the full-sun side", () => {
    const p: PlantInput = { ...pot, directSun: [{ from: 9, to: 17 }] };
    assert.equal(resolveCare(p, "2026-06-21", env).intervalDays, 5);
  });

  it("the same Morning answer gives a longer interval in December than in June", () => {
    const p: PlantInput = { ...pot, directSun: morning };
    const jun = resolveCare(p, "2026-06-21", env).intervalDays;
    const dec = resolveCare(p, "2026-12-21", env).intervalDays;
    assert.ok(dec > jun, `${String(dec)} vs ${String(jun)}`);
  });

  it("a plant with no answer keeps today's plan", () => {
    const care = resolveCare(pot, "2026-06-21", env);
    assert.equal(care.intervalDays, 7);
    assert.equal(care.mode, "interval");
  });

  it("ground, establishing: hours replace the class factor", () => {
    const ground: PlantInput = {
      id: "g",
      style: "let_top_dry",
      intervalDays: 7,
      placement: "ground",
      sun: "part_shade",
      groundSoil: "loam",
      plantedOn: "2026-05-01",
      establishmentSeasons: 1,
      droughtTolerance: "none",
      establishingIntervalDays: 7,
    };
    const base = resolveCare(ground, "2026-06-21", env).intervalDays;
    const shady = resolveCare({ ...ground, directSun: [] }, "2026-06-21", env).intervalDays;
    const sunny = resolveCare(
      { ...ground, directSun: [{ from: 9, to: 17 }] },
      "2026-06-21",
      env,
    ).intervalDays;
    assert.equal(base, 7);
    assert.equal(shady, 8); // 7 x 1.2 = 8.4
    assert.equal(sunny, 6); // 7 x 0.85 = 5.95
  });

  it("solar noon for GB is later than for the zone default, so a morning loses a little", () => {
    const gb = directSunHours([{ from: 6, to: 10 }], "2026-12-21", { ...edinburgh, country: "GB" });
    const other = directSunHours([{ from: 6, to: 10 }], "2026-12-21", {
      hemisphere: "north",
      latitude: 55,
    });
    assert.ok(gb < other);
  });
});

describe("hours to the indoor light factor", () => {
  it("3 hours pull a bright_indirect window towards direct, saturating at 4 hours", () => {
    const base = startMultipliers({ light: "bright_indirect" }).light;
    assert.equal(base, 0.65);
    near(startMultipliers({ light: "bright_indirect", sunHours: 3 }).light, 0.4625, 0.001);
    assert.equal(startMultipliers({ light: "bright_indirect", sunHours: 4 }).light, 0.4);
    assert.equal(startMultipliers({ light: "bright_indirect", sunHours: 9 }).light, 0.4);
  });

  it("no hours, or 0 hours, leave the class factor alone", () => {
    assert.equal(startMultipliers({ light: "low" }).light, 1.6);
    assert.equal(startMultipliers({ light: "low", sunHours: 0 }).light, 1.6);
  });

  it("hours with no class start from medium", () => {
    near(startMultipliers({ sunHours: 2 }).light, 0.7, 0.001);
  });

  it("an indoor plant's directSun reaches the working interval through resolveCare", () => {
    const indoor: PlantInput = {
      id: "i",
      style: "let_top_dry",
      intervalDays: 10,
      light: "bright_indirect",
      directSun: [{ from: 8, to: 12 }],
    };
    const care = resolveCare(indoor, "2026-06-21", env);
    near(care.sunHours ?? -1, 4, 0.05);
    const none = resolveCare(
      {
        id: "i",
        style: "let_top_dry" as const,
        intervalDays: 10,
        light: "bright_indirect" as const,
      },
      "2026-06-21",
      env,
    );
    assert.equal(none.sunHours, undefined);
  });
});
