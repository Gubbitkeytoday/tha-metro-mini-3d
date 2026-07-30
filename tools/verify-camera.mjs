// Camera-input check: drives the map with REAL mouse events (not by poking
// window.__map) and asserts each gesture moves the camera the intended way.
//
//   left-drag                          -> pan
//   wheel                              -> zoom
//   middle- / right- / ctrl+left-drag  -> orbit: vertical pitches and
//                                         horizontal turns TOGETHER, in
//                                         MapLibre's own directions and rates
//
// Usage: npm run verify:camera   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";
const CX = 600;
const CY = 400;

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => !!window.__map, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_000));

const reset = () =>
  page.evaluate(() => {
    window.__map.jumpTo({ pitch: 40, bearing: 0, zoom: 12.5 });
  });
const cam = () =>
  page.evaluate(() => {
    const m = window.__map;
    return { pitch: m.getPitch(), bearing: m.getBearing(), zoom: m.getZoom() };
  });

/** Press `button`, move by (dx, dy) in 10 steps, release. */
async function drag(button, dx, dy) {
  await reset();
  await new Promise((r) => setTimeout(r, 300));
  const before = await cam();
  await page.mouse.move(CX, CY);
  await page.mouse.down({ button });
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(CX + (dx * i) / 10, CY + (dy * i) / 10);
  }
  await page.mouse.up({ button });
  await new Promise((r) => setTimeout(r, 400));
  return { before, after: await cam() };
}

async function wheel(deltaY) {
  await reset();
  await new Promise((r) => setTimeout(r, 300));
  const before = await cam();
  await page.mouse.move(CX, CY);
  await page.mouse.wheel({ deltaY });
  await new Promise((r) => setTimeout(r, 700));
  return { before, after: await cam() };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};

// --- pitch: vertical component, MapLibre's own direction (-0.5 * dy) ---
{
  const up = await drag("middle", 0, -60);
  check(
    "drag up raises pitch (MapLibre direction)",
    up.after.pitch > up.before.pitch + 1,
    `pitch ${up.before.pitch.toFixed(1)} -> ${up.after.pitch.toFixed(1)}`,
  );
  const down = await drag("middle", 0, 60);
  check(
    "drag down flattens pitch (MapLibre direction)",
    down.after.pitch < down.before.pitch - 1,
    `pitch ${down.before.pitch.toFixed(1)} -> ${down.after.pitch.toFixed(1)}`,
  );
}

// --- bearing: horizontal component, MapLibre's own direction (+0.8 * dx) ---
{
  const right = await drag("right", 80, 0);
  check(
    "drag rightward turns bearing positive (MapLibre direction)",
    right.after.bearing > right.before.bearing + 1,
    `bearing ${right.before.bearing.toFixed(1)} -> ${right.after.bearing.toFixed(1)}`,
  );
  const left = await drag("right", -80, 0);
  check(
    "drag leftward turns bearing negative (MapLibre direction)",
    left.after.bearing < left.before.bearing - 1,
    `bearing ${left.before.bearing.toFixed(1)} -> ${left.after.bearing.toFixed(1)}`,
  );
}

// --- merged: one diagonal drag must move BOTH axes, on every orbit button ---
for (const button of ["middle", "right"]) {
  const d = await drag(button, 80, -60);
  check(
    `${button}-drag diagonal pitches and turns together`,
    d.after.pitch > d.before.pitch + 1 && d.after.bearing > d.before.bearing + 1,
    `pitch ${d.before.pitch.toFixed(1)} -> ${d.after.pitch.toFixed(1)}, ` +
      `bearing ${d.before.bearing.toFixed(1)} -> ${d.after.bearing.toFixed(1)}`,
  );
}

// --- zoom: wheel ---
{
  const zin = await wheel(-240);
  check(
    "wheel up zooms in",
    zin.after.zoom > zin.before.zoom + 0.05,
    `zoom ${zin.before.zoom.toFixed(2)} -> ${zin.after.zoom.toFixed(2)}`,
  );
  const zout = await wheel(240);
  check(
    "wheel down zooms out",
    zout.after.zoom < zout.before.zoom - 0.05,
    `zoom ${zout.before.zoom.toFixed(2)} -> ${zout.after.zoom.toFixed(2)}`,
  );
  check(
    "wheel leaves pitch and bearing alone",
    Math.abs(zout.after.pitch - zout.before.pitch) < 0.5 &&
      Math.abs(zout.after.bearing - zout.before.bearing) < 0.5,
    `pitch ${zout.after.pitch.toFixed(1)}, bearing ${zout.after.bearing.toFixed(1)}`,
  );
}

// --- pan: left-drag still moves the map centre ---
{
  const pan = await drag("left", 120, 0);
  const moved = await page.evaluate(() => window.__map.getCenter().lng);
  check(
    "left-drag still pans",
    Math.abs(moved - 100.5332) > 1e-4,
    `centre lng -> ${moved.toFixed(5)}`,
  );
  void pan;
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
