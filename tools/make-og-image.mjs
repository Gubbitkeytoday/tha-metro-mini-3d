#!/usr/bin/env node
/**
 * Render the social preview card (public/og-image.png) from the real app.
 *
 * A hand-drawn mock would drift from what the site actually looks like the
 * first time anything changed; this screenshots the running app at exactly the
 * 1200x630 that Open Graph consumers crop to, with the UI chrome hidden so the
 * card is the map rather than a picture of a control panel.
 *
 * Usage: node tools/make-og-image.mjs   (dev server must be running on :5173)
 */
import puppeteer from "puppeteer-core";

const PAGE_URL = process.argv[2] ?? "http://localhost:5173/?lang=en";
const OUT = new URL("../public/og-image.png", import.meta.url);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  // The canonical Open Graph size. Facebook, LINE, Discord, Slack and X all
  // crop toward 1.91:1; giving them exactly that avoids a surprise crop.
  defaultViewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__map && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => window.__store.getState().routes.length > 0, { timeout: 30_000 });

// Skip the first-run tour and hide every overlay: the card should show the
// network, not the UI.
await page.evaluate(() => {
  const s = window.__store.getState();
  s.setTourOpen(false);
  s.setAboutOpen(false);
  s.setShowStationLabels(true);
  s.setBuildings(true);
  s.setLightingMode("day");
  const style = document.createElement("style");
  style.textContent = `
    .maplibregl-control-container { display: none !important; }
    #root > div > *:not(:first-child) { display: none !important; }
  `;
  document.head.appendChild(style);
});

// A three-quarter view over the central interchange cluster: enough lines to
// read as a network, close enough that station names are legible.
await page.evaluate(() => {
  window.__map.jumpTo({ center: [100.5405, 13.75], zoom: 12.9, pitch: 62, bearing: -22 });
});
// Let tiles finish and the labels settle through a declutter pass or two.
await new Promise((r) => setTimeout(r, 6_000));

await page.screenshot({ path: OUT, type: "png" });
console.log(`Wrote ${OUT.pathname} (1200x630)`);
await browser.close();
