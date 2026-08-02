#!/usr/bin/env node
/**
 * Render the README's screenshot gallery into `docs/media/`.
 *
 * Every shot is taken from the running app, scripted, so the gallery can be
 * regenerated after any visual change instead of slowly drifting away from what
 * the site looks like. Hand-captured screenshots are the reason so many READMEs
 * show a UI that no longer exists.
 *
 * Each entry sets its own camera, store state and viewport, then waits for the
 * thing it is meant to show to actually be on screen — a screenshot taken
 * before the labels have been laid out or the trains have arrived is a picture
 * of a loading state.
 *
 * Usage: npm run media   (dev server must be running on :5173)
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const URL_BASE = process.argv[2] ?? "http://localhost:5173/";
const OUT_DIR = resolve(import.meta.dirname, "../docs/media");
mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1600, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the base map has finished fetching and drawing its tiles.
 *
 * Not optional, and not something a fixed sleep can stand in for: the first
 * version of this script used `await sleep(3000)` and the whole-region hero
 * shot came out with the 3D network floating over a blank cream page, because
 * a jump to a new zoom level starts a fresh round of vector-tile requests. A
 * screenshot of a half-loaded map is a screenshot of a bug that does not
 * exist.
 */
async function waitForMapIdle(page, settleMs = 1_200) {
  await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), {
    timeout: 45_000,
    polling: 250,
  });
  // Tiles being present is not the same as the labels having been laid out and
  // the trains having been placed for the current camera.
  await sleep(settleMs);
}

/**
 * A fixed simulated moment for every shot.
 *
 * Screenshots taken "now" differ by time of day, by how many trains happen to
 * be running, and by whether it is night — so the gallery would look different
 * every time it was regenerated, and a diff would be meaningless. 17:40 on a
 * Wednesday is the evening peak: the most trains on the map, in daylight.
 */
const SCENE_TIME = { hours: 17, minutes: 40 };

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: DESKTOP,
});

/** A page with the tour already seen, the engine live and the clock pinned. */
async function openApp(viewport, lang = "en") {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("metro3d.preferences.v1", JSON.stringify({ tourSeen: true }));
    } catch {
      /* storage unavailable — the tour shows, and the shot would show it */
    }
  });
  await page.goto(`${URL_BASE}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => !!window.__map && !!window.__store && !!window.__sim?.current, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__store.getState().stations.length > 0, {
    timeout: 30_000,
  });
  await page.evaluate((t) => {
    const d = new Date();
    // Wednesday of the current week, at the pinned local time: a weekday
    // service pattern, which is the busier of the two in this feed.
    d.setDate(d.getDate() - ((d.getDay() + 4) % 7));
    d.setHours(t.hours, t.minutes, 0, 0);
    window.__sim.current.setClock(d.getTime(), 1);
  }, SCENE_TIME);
  // Let the engine deliver frames at the new clock and the labels declutter.
  await page.waitForFunction(() => window.__store.getState().vehicleCount > 50, { timeout: 20_000 });
  await sleep(2_500);
  return page;
}

/**
 * Centre the camera on a train that is actually in transit.
 *
 * Aiming at a landmark and hoping a train is passing does not work — the first
 * version of the street-level shot framed Siam beautifully with no train
 * anywhere in it. The subject of that shot is the rolling stock, so the camera
 * has to be placed from the vehicle buffer.
 */
async function frameALiveTrain(page, { zoom, pitch, bearing }) {
  const found = await page.evaluate(
    (view) => {
      const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
      for (let i = 0; i < count; i++) {
        const b = i * 8;
        if (vehicles[b + 4] !== 1) continue; // in transit, not dwelling
        const { lng, lat } = window.__localToLngLat(vehicles[b], vehicles[b + 1]);
        // Look along the train's own heading, so the consist is seen down its
        // length rather than as a line crossing the frame.
        const yaw = vehicles[b + 3];
        window.__map.jumpTo({
          center: [lng, lat],
          zoom: view.zoom,
          pitch: view.pitch,
          bearing: view.bearing ?? (90 - (yaw * 180) / Math.PI + 210) % 360,
        });
        return { runIdx: vehicles[b + 5], routeIdx: vehicles[b + 6] };
      }
      return null;
    },
    { zoom, pitch, bearing },
  );
  return found;
}

async function shot(page, name) {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  console.log(`wrote docs/media/${name}.png`);
}

// --- 1. hero: the whole region, which is the view the app opens at ----------

{
  const page = await openApp(DESKTOP);
  // Zoom 11.2 rather than further out: it is the closest view that still holds
  // every line end to end, and far enough out that the angular-sized station
  // labels read as a network map instead of covering it.
  await page.evaluate(() =>
    window.__map.jumpTo({ center: [100.545, 13.755], zoom: 11.2, pitch: 52, bearing: -18 }),
  );
  await waitForMapIdle(page, 2_500);
  await shot(page, "01-network-overview");

  // --- 2. street level: rolling stock, livery and station labels ------------
  // 18.6 rather than 17: at 17 a 65 m consist is a few dozen pixels across and
  // the shot reads as a cityscape that happens to contain a train.
  const framed = await frameALiveTrain(page, { zoom: 18.6, pitch: 62 });
  await waitForMapIdle(page, 2_000);
  if (framed) {
    await shot(page, "02-trains-street-level");
  } else {
    console.log("skipped 02-trains-street-level: no train in transit at the scene time");
  }

  // --- 3. underground: MRT Blue's tunnelled core, seen through the city -----
  await page.evaluate(() => {
    window.__store.getState().setUndergroundVisible(true);
    // Close and low over Hua Lamphong, looking along the tunnel: from further
    // out the below-ground track is technically visible but reads as a faint
    // line, which does not show what the mode is for.
    window.__map.jumpTo({ center: [100.5155, 13.7395], zoom: 16.1, pitch: 78, bearing: -64 });
  });
  await waitForMapIdle(page, 2_000);
  await shot(page, "03-underground-mrt-blue");
  await page.evaluate(() => window.__store.getState().setUndergroundVisible(false));

  // --- 4. night, driven by the simulated clock ------------------------------
  await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 4) % 7));
    d.setHours(20, 30, 0, 0);
    window.__sim.current.setClock(d.getTime(), 1);
    window.__map.jumpTo({ center: [100.5405, 13.7465], zoom: 13.4, pitch: 66, bearing: -14 });
  });
  await waitForMapIdle(page, 3_000);
  await shot(page, "04-night-lighting");
  await page.close();
}

// --- 5. the journey planner, mid-answer ------------------------------------

{
  const page = await openApp(DESKTOP);
  await page.evaluate(() =>
    window.__map.jumpTo({ center: [100.5405, 13.7465], zoom: 12.6, pitch: 58, bearing: -18 }),
  );
  await waitForMapIdle(page);
  await page.click('[data-tour="planner"]');
  await page.waitForSelector('div[data-panel="planner"] input[type="search"]');
  const type = async (text) => {
    const input = await page.$('div[data-panel="planner"] input[type="search"]');
    await input.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await input.type(text, { delay: 15 });
    await sleep(400);
  };
  // A trip that genuinely needs a change, so the leg list shows the thing the
  // feature exists for rather than a single "stay on this line".
  await type("mo chit");
  await page.click('div[data-panel="planner"] ul li button:first-child');
  await sleep(600);
  await type("suvarnabhumi");
  await page.click('div[data-panel="planner"] ul li button:first-child');
  await page.waitForFunction(() => !!document.querySelector('div[data-panel="planner"] ol li'), {
    timeout: 20_000,
  });
  await sleep(1_500);
  await shot(page, "05-journey-planner");
  await page.close();
}

// --- 6. train inspector and live station board -----------------------------

{
  const page = await openApp(DESKTOP);
  // Select a train that is actually running, rather than clicking a pixel and
  // hoping: the inspector is the subject of this shot.
  const picked = await page.evaluate(() => {
    const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
    for (let i = 0; i < count; i++) {
      const b = i * 8;
      if (vehicles[b + 4] === 1) {
        window.__store.getState().selectRun(vehicles[b + 5]);
        return { x: vehicles[b], y: vehicles[b + 1] };
      }
    }
    return null;
  });
  if (picked) {
    await page.evaluate((p) => {
      const { lng, lat } = window.__localToLngLat(p.x, p.y);
      window.__map.jumpTo({ center: [lng, lat], zoom: 15.8, pitch: 70, bearing: 12 });
    }, picked);
    await waitForMapIdle(page);
    await page.waitForFunction(
      () => !!document.querySelector('[role="dialog"], [data-panel]'),
      { timeout: 15_000 },
    );
    await sleep(2_000);
    await shot(page, "06-train-inspector");
  } else {
    console.log("skipped 06-train-inspector: no train in transit at the scene time");
  }

  // Station board: pick a busy interchange so the board has departures on it.
  await page.evaluate(() => {
    const s = window.__store.getState();
    const asok = s.stations.find((v) => v.name_en === "Asok") ?? s.stations[0];
    s.selectStation({ routeIdx: asok.route_idx, stationIdx: asok.station_idx });
    const { lng, lat } = window.__localToLngLat(asok.x, asok.y);
    window.__map.jumpTo({ center: [lng, lat], zoom: 15.6, pitch: 68, bearing: -30 });
  });
  await waitForMapIdle(page, 2_000);
  await shot(page, "07-station-board");
  await page.close();
}

// --- 8. the guided tour, spotlight and all ---------------------------------

{
  const page = await openApp(DESKTOP);
  await page.evaluate(() => {
    window.__store.getState().setTourOpen(true);
    window.__map.jumpTo({ center: [100.545, 13.755], zoom: 11.6, pitch: 55, bearing: -18 });
  });
  await waitForMapIdle(page);
  // Step 2 is the line panel: a spotlight with a real cut-out and an arrow,
  // which is what makes the tour worth showing at all.
  for (const label of ["Next", "ต่อไป"]) {
    const button = await page.$$(`button ::-p-text(${label})`);
    if (button.length) {
      await button[0].click();
      break;
    }
  }
  await sleep(2_500);
  await shot(page, "08-guided-tour");
  await page.close();
}

// --- 9. support panel with the PromptPay code -----------------------------

{
  const page = await openApp(DESKTOP);
  await page.evaluate(() => {
    window.__store.getState().setAboutOpen(true);
    window.__map.jumpTo({ center: [100.545, 13.752], zoom: 13.1, pitch: 56, bearing: -18 });
  });
  await waitForMapIdle(page);
  await page.evaluate(() => {
    // The support section is at the bottom of a scrolling panel.
    const panel = document.querySelector('[role="dialog"] .overflow-y-auto');
    if (panel) panel.scrollTop = panel.scrollHeight;
  });
  await sleep(600);
  await shot(page, "09-about-support");
  await page.close();
}

// --- 10 & 11. phone: the map, and the planner as a sheet -------------------

{
  const page = await openApp(PHONE, "th");
  await page.evaluate(() =>
    window.__map.jumpTo({ center: [100.5405, 13.7465], zoom: 12.4, pitch: 60, bearing: -18 }),
  );
  await waitForMapIdle(page, 2_000);
  await shot(page, "10-phone-map-thai");

  await page.click('[data-tour="planner"]');
  await page.waitForSelector('div[data-panel="planner"] input[type="search"]');
  const input = await page.$('div[data-panel="planner"] input[type="search"]');
  await input.type("สยาม", { delay: 25 });
  await sleep(1_200);
  await shot(page, "11-phone-search-thai");
  await page.close();
}

await browser.close();
console.log("\ngallery written to docs/media/");
