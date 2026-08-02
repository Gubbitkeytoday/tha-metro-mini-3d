// MVP 4 acceptance check (SRS §7 MVP 4 DoD): a user can select a train, follow
// it, scrub time, and read live schedule info.
//
// Assertions go through the engine's own query path and the real click
// handler, so a regression in the Rust schedule logic, the worker query
// protocol, or the picking code fails this — not just React rendering.
//
// Usage: npm run verify:mvp4   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
// Enter as a RETURNING visitor. On a fresh profile the first-run tour opens
// and deliberately blocks clicks on everything behind it, which would make
// every synthetic interaction below hit the tour instead of the app.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("metro3d.preferences.v1", JSON.stringify({ tourSeen: true }));
  } catch {
    /* storage unavailable — the tour simply shows, as it would for a user */
  }
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_500));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};
const finish = async (fatal) => {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (fatal || failed.length) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
};

// --- engine query surface ---------------------------------------------------

const stations = await page.evaluate(() => window.__sim.current.getStations());
check(
  "engine returns stations with ENU positions",
  stations.length > 0 && Number.isFinite(stations[0]?.x),
  `${stations.length} stations, first "${stations[0]?.name_en}"`,
);

// Prefer a train that is on screen AND in transit: a dwelling train would make
// the follow-camera movement assertion depend on timetable luck.
const live = await page.evaluate(() => {
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  if (!count) return null;
  let fallback = null;
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    const p = window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
    const onScreen = p.x > 60 && p.y > 60 && p.x < 1340 && p.y < 840;
    const entry = { runIdx: vehicles[o + 5], count, onScreen, inTransit: vehicles[o + 4] === 1 };
    if (onScreen && entry.inTransit) return entry;
    fallback ??= entry;
  }
  return fallback;
});
check("vehicles live in the buffer", live !== null, live ? `${live.count} vehicles` : "none");
if (!live) {
  console.log("\nno vehicles to inspect — outside service hours?");
  await finish(true);
}

const detail = await page.evaluate((runIdx) => {
  const c = window.__sim.current;
  return c.getRunDetail(runIdx, c.getSimNow());
}, live.runIdx);
check(
  "run detail carries route, headsign, origin and destination",
  !!detail?.origin && !!detail?.destination && !!detail?.headsign && !!detail?.route_name,
  detail ? `${detail.headsign}: ${detail.origin} -> ${detail.destination}` : "null",
);
check(
  "run detail carries the full call list with times",
  detail?.stops.length > 1 && detail.stops.every((s) => s.arrival_sec >= 0),
  detail ? `${detail.stops.length} calls` : "none",
);
check(
  "next-station ETA present, or flagged as terminus",
  !!detail &&
    ((detail.next_station !== null && detail.next_arrival_in_s !== null) ||
      detail.next_station === null),
  detail ? `next=${detail.next_station} in ${detail.next_arrival_in_s}s` : "none",
);

const board = await page.evaluate(async () => {
  const c = window.__sim.current;
  const all = await c.getStations();
  const s = all[Math.floor(all.length / 2)];
  const b = await c.getStationBoard(s.route_idx, s.station_idx, c.getSimNow(), 8);
  return { name: s.name_en, entries: b?.entries ?? [] };
});
check(
  "station board returns upcoming calls, soonest first",
  board.entries.length > 0 &&
    board.entries.every((e, i, a) => i === 0 || a[i - 1].in_s <= e.in_s),
  `${board.name}: ${board.entries.length} entries`,
);

// --- real click path: project a train to screen pixels and click it ---------

await page.evaluate(() => window.__store.getState().selectRun(null));
const hitPoint = await page.evaluate((runIdx) => {
  const c = window.__sim.current;
  const { vehicles, count } = c.getInterpolated(performance.now());
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    if (vehicles[o + 5] === runIdx) {
      const p = window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
      return { x: p.x, y: p.y };
    }
  }
  return null;
}, live.runIdx);

if (hitPoint && hitPoint.x > 0 && hitPoint.y > 0 && hitPoint.x < 1400 && hitPoint.y < 900) {
  await page.mouse.click(hitPoint.x, hitPoint.y);
  await new Promise((r) => setTimeout(r, 600));
  const picked = await page.evaluate(() => window.__store.getState().selectedRunIdx);
  // Must be THE train we aimed at, not merely something: the click lands on
  // its exact projected point, so any other result is a picking bug.
  check(
    "clicking a train on the canvas selects that train",
    picked === live.runIdx,
    `clicked (${hitPoint.x.toFixed(0)}, ${hitPoint.y.toFixed(0)}) -> run ${picked}, wanted ${live.runIdx}`,
  );
} else {
  // The chosen train is off-screen at the default camera; select directly so
  // the remaining checks still run, and say so rather than silently passing.
  await page.evaluate((runIdx) => window.__store.getState().selectRun(runIdx), live.runIdx);
  check(
    "clicking a train on the canvas selects that train",
    false,
    "train off-screen, click not exercised",
  );
}

await new Promise((r) => setTimeout(r, 1_200));
const bodyText = await page.evaluate(() => document.body.innerText);
const selectedDetail = await page.evaluate(() => {
  const c = window.__sim.current;
  const idx = window.__store.getState().selectedRunIdx;
  return idx === null ? null : c.getRunDetail(idx, c.getSimNow());
});
check(
  "inspector renders the engine's data for the selection",
  !!selectedDetail && bodyText.includes(selectedDetail.destination),
  `destination "${selectedDetail?.destination}" visible in the DOM`,
);

// --- station click opens the board -----------------------------------------

// Close the inspector first: it is an absolutely-positioned panel on the right
// and would swallow a canvas click underneath it.
await page.evaluate(() => window.__store.getState().selectRun(null));
await new Promise((r) => setTimeout(r, 400));

const stationPoint = await page.evaluate(() => {
  const map = window.__map;
  const all = window.__store.getState().stations;
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  const trains = [];
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    trains.push(map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1])));
  }
  for (const s of all) {
    const p = map.project(window.__localToLngLat(s.x, s.y));
    // Keep clear of the legend card (top-left) and the clock/scrubber (bottom).
    const clear = p.x > 320 && p.y > 60 && p.x < 1340 && p.y < 700;
    if (!clear) continue;
    // Trains win ties in pickAt(), so avoid stations with one sitting on them.
    const busy = trains.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 30);
    if (!busy) return { x: p.x, y: p.y, name: s.name_en };
  }
  return null;
});
if (stationPoint) {
  await page.mouse.click(stationPoint.x, stationPoint.y);
  await new Promise((r) => setTimeout(r, 1_200));
  const station = await page.evaluate(() => window.__store.getState().selectedStation);
  // innerText is the RENDERED text, and the drawer heading is styled
  // `uppercase` — compare case-insensitively.
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  check(
    "clicking a station opens its live timetable",
    station !== null &&
      text.includes("next departures") &&
      text.includes(stationPoint.name.toLowerCase()),
    `${stationPoint.name} -> station ${station?.stationIdx}`,
  );
} else {
  check("clicking a station opens its live timetable", false, "no station on screen to click");
}

// --- follow camera ----------------------------------------------------------

await page.evaluate((runIdx) => {
  const st = window.__store.getState();
  st.selectRun(runIdx);
  st.setFollowing(true);
}, live.runIdx);
await new Promise((r) => setTimeout(r, 600));

/** Metres between the map centre and the followed train's own position. */
const centreOffset = () =>
  page.evaluate((runIdx) => {
    const c = window.__sim.current;
    const { vehicles, count } = c.getInterpolated(performance.now());
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      if (vehicles[o + 5] === runIdx) {
        const t = window.__localToLngLat(vehicles[o], vehicles[o + 1]);
        const m = window.__map.getCenter();
        return Math.hypot((m.lng - t.lng) * 108_000, (m.lat - t.lat) * 111_000);
      }
    }
    return null;
  }, live.runIdx);

// The contract is "camera stays on the train", which holds whether it is
// moving or dwelling — asserting displacement instead would depend on
// whether the sampled train happens to be at a stop.
const lock0 = await centreOffset();
await new Promise((r) => setTimeout(r, 3_000));
const lock1 = await centreOffset();
check(
  "follow camera stays locked on the train",
  lock0 !== null && lock1 !== null && lock0 < 3 && lock1 < 3,
  `offset ${lock0?.toFixed(2)} m -> ${lock1?.toFixed(2)} m`,
);

// Regression: MapLibre's default 3px clickTolerance let ordinary pointer
// jitter between mousedown/mouseup get misclassified as a drag, firing
// dragstart -> onDragStart -> setFollowing(false), so the very next click
// after engaging follow silently cancelled it. page.mouse.click() never
// moves the pointer between down/up, so it can't reproduce this — the
// down/move/up sequence below injects real jitter, under the 6px tolerance
// but over MapLibre's 3px default.
const jitterPoint = await page.evaluate((runIdx) => {
  const c = window.__sim.current;
  const { vehicles, count } = c.getInterpolated(performance.now());
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    if (vehicles[o + 5] === runIdx) {
      const p = window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
      return { x: p.x, y: p.y };
    }
  }
  return null;
}, live.runIdx);
if (jitterPoint) {
  await page.mouse.move(jitterPoint.x, jitterPoint.y);
  await page.mouse.down();
  await page.mouse.move(jitterPoint.x + 4, jitterPoint.y + 2);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const stillFollowing = await page.evaluate(() => window.__store.getState().following);
  check(
    "a jittery click while following does not cancel follow (regression)",
    stillFollowing === true,
    `following=${stillFollowing}`,
  );
} else {
  check(
    "a jittery click while following does not cancel follow (regression)",
    false,
    "followed train off-screen, click not exercised",
  );
}

await page.evaluate(() => window.__store.getState().setFollowing(false));
await new Promise((r) => setTimeout(r, 500));
const c2 = await page.evaluate(() => window.__map.getCenter());
await new Promise((r) => setTimeout(r, 1_500));
const c3 = await page.evaluate(() => window.__map.getCenter());
const driftM = Math.hypot((c3.lng - c2.lng) * 108_000, (c3.lat - c2.lat) * 111_000);
check("releasing follow stops the camera", driftM < 1, `centre drift ~${driftM.toFixed(2)} m`);

// --- time scrubbing ---------------------------------------------------------

const before = await page.evaluate(() => window.__sim.current.getSimNow());
await page.evaluate(() => {
  const c = window.__sim.current;
  // The same rebase the slider performs, three hours back.
  c.setClock(c.getSimNow() - 3 * 3_600_000, c.getClockParams().warp);
});
await new Promise((r) => setTimeout(r, 1_500));
const after = await page.evaluate(() => window.__sim.current.getSimNow());
check(
  "scrubbing rebases the sim clock",
  before - after > 2.5 * 3_600_000,
  `moved back ${((before - after) / 3_600_000).toFixed(2)} h`,
);
const reEvaluated = await page.evaluate(() => {
  const c = window.__sim.current;
  const { count } = c.getInterpolated(performance.now());
  return count;
});
check(
  "engine re-evaluated at the scrubbed time",
  reEvaluated > 0,
  `${reEvaluated} vehicles three hours earlier`,
);

await finish(false);
