// Jump the camera onto an in-transit train and screenshot it.
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const OUT = `${process.env.TEMP}/mvp3closeup`;
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1000 },
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
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_000));

const jumped = await page.evaluate(() => {
  const client = window.__sim?.current;
  const map = window.__map;
  if (!client || !map) return null;
  const { vehicles, count } = client.getInterpolated(performance.now());
  // pick an in-transit vehicle (state lane 4 === 1), prefer route 0
  // mid-segment so no station disc can be confused with the train
  let pick = -1;
  for (let i = 0; i < count; i++) {
    const p = vehicles[i * 8 + 7];
    if (vehicles[i * 8 + 4] === 1 && p > 0.3 && p < 0.7) { pick = i; if (vehicles[i * 8 + 6] === 0) break; }
  }
  if (pick < 0) return null;
  const x = vehicles[pick * 8], y = vehicles[pick * 8 + 1];
  // ENU meters -> lng/lat (inverse of src/map/coordinates.ts, MapLibre math)
  const R = 6371008.8, C = 2 * Math.PI * R;
  const oLng = 100.5332, oLat = 13.7456;
  const mercX0 = (180 + oLng) / 360;
  const mercY0 = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (oLat * Math.PI) / 360))) / 360;
  const k = 1 / (C * Math.cos((oLat * Math.PI) / 180)); // mercator units per meter
  const mercX = mercX0 + x * k, mercY = mercY0 - y * k;
  const lng = mercX * 360 - 180;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - mercY * 360) * Math.PI) / 180)) - 90;
  map.jumpTo({ center: [lng, lat], zoom: 17, pitch: 60, bearing: 30 });
  return { lng, lat, route: vehicles[pick * 8 + 6] };
});
console.log("jumped to train:", JSON.stringify(jumped));

await new Promise((r) => setTimeout(r, 8_000));
await page.screenshot({ path: `${OUT}/train_closeup.png` });
console.log(`wrote ${OUT}/train_closeup.png`);
await browser.close();
