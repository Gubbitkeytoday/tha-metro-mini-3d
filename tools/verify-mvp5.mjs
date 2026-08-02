// MVP 5 acceptance check (SRS §7 MVP 5 DoD): the network is line-agnostic —
// every registered line renders and simulates together, hiding a line only
// touches the scene (never the engine or its clickability), interchange
// metadata surfaces in the UI, and different vehicle types actually render at
// different sizes.
//
// Assertions go through the store, the engine's own buffers/queries, and real
// canvas clicks — same discipline as verify-mvp4.mjs, generalized from two
// named branches to the full N-line registry.
//
// Usage: npm run verify:mvp5   (dev server must be running on :5173)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { LINES } from "./lines.config.mjs";

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

// Warp to the network's busiest recorded minute (per the preprocessor's own
// report) so "multiple lines have trains at once" doesn't depend on what time
// of day this happens to run — the same technique verify-perf.mjs uses.
const report = JSON.parse(readFileSync("public/data/network.report.json", "utf8"));
await page.evaluate((sec) => {
  const c = window.__sim.current;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  c.setClock(day.getTime() + sec * 1000, 1);
}, report.peak_concurrent_time);
await new Promise((r) => setTimeout(r, 2_000));

// --- 1. every registry line renders, in registry order ----------------------

const routeKeys = await page.evaluate(() => window.__store.getState().routes.map((r) => r.key));
check(
  "every registry line renders, in registry order",
  routeKeys.length === LINES.length && routeKeys.every((k, i) => k === LINES[i].key),
  routeKeys.join(", "),
);

// --- 2. trains run on more than one line at once -----------------------------

const routeIdxs = await page.evaluate(() => {
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  const set = new Set();
  for (let i = 0; i < count; i++) set.add(vehicles[i * 8 + 6]);
  return [...set];
});
check(
  "trains run on 3+ lines simultaneously",
  routeIdxs.length >= 3,
  `route_idx present: ${routeIdxs.sort((a, b) => a - b).join(",")} (of ${LINES.length} lines)`,
);

// --- 3/4. hiding a line stops rendering, not simulation or clickability -----

// Silom (idx 1): central, geographically compact around the default Siam
// camera, and consistently busy — a good candidate for "still on screen after
// its track/trains are hidden."
const hiddenIdx = LINES.findIndex((l) => l.key === "silom");

const before = await page.evaluate(() => window.__store.getState().vehicleCount);
await page.evaluate((idx) => window.__store.getState().toggleRoute(idx), hiddenIdx);
await new Promise((r) => setTimeout(r, 1_500));
const after = await page.evaluate(() => window.__store.getState().vehicleCount);
check(
  "hiding a line does not stop its simulation",
  before > 0 && after > 0,
  `vehicleCount ${before} -> ${after} (route ${hiddenIdx}/'${LINES[hiddenIdx].key}' hidden)`,
);

await page.evaluate(() => window.__store.getState().selectRun(null));
const hiddenHit = await page.evaluate((idx) => {
  const c = window.__sim.current;
  const { vehicles, count } = c.getInterpolated(performance.now());
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    if ((vehicles[o + 6] | 0) === idx) {
      const p = window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
      return { x: p.x, y: p.y, runIdx: vehicles[o + 5] };
    }
  }
  return null;
}, hiddenIdx);

if (hiddenHit && hiddenHit.x > 0 && hiddenHit.y > 0 && hiddenHit.x < 1400 && hiddenHit.y < 900) {
  await page.mouse.click(hiddenHit.x, hiddenHit.y);
  await new Promise((r) => setTimeout(r, 500));
  // The assertion is "the hidden train is not what got picked", NOT "nothing
  // got picked". Demanding null was safe with 9 lines but became flaky at 10:
  // MRT Blue shares corridors with Silom, so a *visible* Blue (or Sukhumvit,
  // or Gold) train is often within the pick radius of the hidden Silom train's
  // pixel, and picking that neighbour is correct behaviour, not a leak.
  // Verified directly (2026-08-02) by clicking every on-screen Silom train
  // with the line hidden: the picked route was 0, 6 or 9 — never 1.
  const picked = await page.evaluate(() => {
    const runIdx = window.__store.getState().selectedRunIdx;
    if (runIdx === null) return { runIdx: null, routeIdx: null };
    const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
    for (let i = 0; i < count; i++) {
      if (vehicles[i * 8 + 5] === runIdx) return { runIdx, routeIdx: vehicles[i * 8 + 6] | 0 };
    }
    return { runIdx, routeIdx: null };
  });
  check(
    "a hidden line's train cannot be clicked",
    picked.runIdx === null || picked.routeIdx !== hiddenIdx,
    `clicked (${hiddenHit.x.toFixed(0)}, ${hiddenHit.y.toFixed(0)}) on hidden route ${hiddenIdx} -> ` +
      `selectedRunIdx ${picked.runIdx} on route ${picked.routeIdx}`,
  );
} else {
  check(
    "a hidden line's train cannot be clicked",
    false,
    `no on-screen train found on hidden route ${hiddenIdx} ('${LINES[hiddenIdx].key}') to exercise the click`,
  );
}

// Restore visibility so it doesn't leak into the remaining checks.
await page.evaluate((idx) => window.__store.getState().toggleRoute(idx), hiddenIdx);
await new Promise((r) => setTimeout(r, 300));

// --- 5. an interchange station shows at least one transfer chip -------------

const interchangeStation = await page.evaluate(() => {
  const stations = window.__store.getState().stations;
  return stations.find((s) => s.interchanges && s.interchanges.length > 0) ?? null;
});

if (interchangeStation) {
  await page.evaluate(
    (s) => window.__store.getState().selectStation({ routeIdx: s.route_idx, stationIdx: s.station_idx }),
    interchangeStation,
  );
  await new Promise((r) => setTimeout(r, 800));
  const chip = await page.evaluate((s) => {
    const routes = window.__store.getState().routes;
    const names = s.interchanges.map((ix) => routes[ix.route_idx]?.name).filter(Boolean);
    // The "Interchange" label and route-name chips render inside a
    // `uppercase` heading — innerText reflects the CSS text-transform, so
    // compare case-insensitively (same gotcha verify-mvp4.mjs documents for
    // "next departures").
    const text = document.body.innerText.toLowerCase();
    return {
      names,
      hasLabel: text.includes("interchange"),
      hasName: names.some((n) => text.includes(n.toLowerCase())),
    };
  }, interchangeStation);
  check(
    "an interchange station shows a transfer chip naming the other line",
    chip.hasLabel && chip.hasName,
    `${interchangeStation.name_en}: expected one of [${chip.names.join(", ")}]`,
  );
  await page.evaluate(() => window.__store.getState().selectStation(null));
} else {
  check(
    "an interchange station shows a transfer chip naming the other line",
    false,
    "no station in the engine's data carries interchanges — link_interchanges() regression?",
  );
}

// --- 6. a monorail train is visibly shorter than a heavy-rail train ---------
// Reads the actual InstancedMesh geometry built by VehicleManager (not just
// the ConsistSpec table), so a bug in buildTrainGeometry/vehicleModels.ts
// integration would fail this too.

const lengths = await page.evaluate(() => {
  // map.getLayer() hands back MapLibre's own StyleLayer wrapper, not the
  // CustomLayerInterface passed to addLayer() — the actual NetworkLayer
  // instance (and its Three scene) lives on `.implementation`.
  const layer = window.__map.getLayer("network-3d");
  const scene = layer?.implementation?.scene;
  const routes = window.__store.getState().routes;
  const meshLength = (routeIdx) => {
    const mesh = scene?.getObjectByName(`vehicles-route-${routeIdx}`);
    if (!mesh) return null;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    return box.max.x - box.min.x;
  };
  const heavyIdx = routes.findIndex((r) => r.vehicleType === "heavy");
  const monoIdx = routes.findIndex((r) => r.vehicleType === "monorail");
  return {
    heavyIdx,
    monoIdx,
    heavy: heavyIdx >= 0 ? meshLength(heavyIdx) : null,
    monorail: monoIdx >= 0 ? meshLength(monoIdx) : null,
  };
});
check(
  "a monorail train's rendered geometry is visibly shorter than a heavy-rail train's",
  lengths.heavy !== null && lengths.monorail !== null && lengths.monorail < lengths.heavy,
  `monorail (route ${lengths.monoIdx}) ${lengths.monorail?.toFixed(1)} m vs heavy (route ${lengths.heavyIdx}) ${lengths.heavy?.toFixed(1)} m`,
);

await finish(false);
