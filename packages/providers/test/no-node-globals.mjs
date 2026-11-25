// SPDX-License-Identifier: AGPL-3.0-only
// Child process for no-node-globals.test.ts: removes the Node-only globals, then loads the weather path
// and asks it for an answer through a fake fetch, as a runtime with no process and no Buffer would.
delete globalThis.process;
delete globalThis.Buffer;
const { WeatherService, OpenMeteo } = await import("../src/index.ts");
const body = {
  daily: {
    time: ["2026-11-25", "2026-11-26"],
    precipitation_sum: [0, 1],
    temperature_2m_min: [3, 1],
    temperature_2m_max: [9, 6],
  },
};
const fetcher = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
let saved;
const service = new WeatherService({
  weather: new OpenMeteo(fetcher, () => "2026-11-25T08:00:00Z"),
  gauges: {},
  store: { load: () => Promise.resolve(saved), save: (v) => ((saved = v), Promise.resolve()) },
  now: () => new Date("2026-11-25T08:00:00Z"),
});
const reply = await service.report({ lat: 55.95, lon: -3.19 }, "2026-11-25");
console.log(
  JSON.stringify({
    process: typeof globalThis.process,
    buffer: typeof globalThis.Buffer,
    days: reply.days.length,
    tMinC: reply.days[1]?.tMinC,
  }),
);
