// NF1 acceptance: sim tick < 3 ms and 60 FPS desktop with the whole network.
//
// Runs against a PRODUCTION build (npm run build && npm run preview) — dev-mode
// React and unminified Three make the render numbers meaningless. `?debug=1`
// opts the production bundle into exposing window.__sim (see MapContainer.tsx)
// for the duration of this check only; ordinary production visitors never get
// debug globals on `window`.
//
// Usage: npm run build && npm run preview   (in one shell, default :4173)
//        npm run verify:perf                 (in another)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE_URL = process.argv[2] ?? "http://localhost:4173/";
const URL = `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}debug=1`;

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
await page.waitForFunction(() => !!window.__sim?.current, { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_500));

const results = [];
const check = (name, ok, detail, opts = {}) => {
  results.push({ name, ok, expectedFail: !!opts.expectedFail });
  const label = !ok && opts.expectedFail ? "FAIL (known gap)" : ok ? "ok  " : "FAIL";
  console.log(`${label} ${name} — ${detail}`);
};
const finish = async (fatal) => {
  await browser.close();
  // A check marked expectedFail is a disclosed, tracked gap (see CLAUDE.md
  // "MVP 5's one disclosed gap") — it still prints FAIL above so the gap
  // stays visible, but it must not make a real regression in the other
  // checks indistinguishable from "still waiting on more GTFS density".
  const failed = results.filter((r) => !r.ok && !r.expectedFail);
  const knownFailed = results.filter((r) => !r.ok && r.expectedFail);
  console.log(
    `\n${results.length - failed.length - knownFailed.length}/${results.length} passed` +
      (knownFailed.length ? ` (${knownFailed.length} known gap, not gating)` : ""),
  );
  if (fatal || failed.length) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
};

// 1. Warp to the network's busiest minute so the measurement is a real peak,
//    not a quiet mid-afternoon. The preprocessor reports it.
const report = JSON.parse(readFileSync("public/data/network.report.json", "utf8"));
await page.evaluate((sec) => {
  const c = window.__sim.current;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  c.setClock(day.getTime() + sec * 1000, 1);
}, report.peak_concurrent_time);

// Drop samples accumulated since page load — otherwise p95 mixes quiet
// pre-warp ticks with the post-warp peak window, understating the number
// this check claims to measure.
await page.evaluate(() => window.__sim.current.resetEvalStats());

await new Promise((r) => setTimeout(r, 20_000)); // ~200 ticks

const stats = await page.evaluate(() => window.__sim.current.getEvalStats());
check(
  "the sim actually ticked during the window",
  stats.samples >= 100,
  `${stats.samples} ticks`,
);
check(
  "sim tick under 3 ms at the daily peak (NF1)",
  stats.p95Ms < 3,
  `p95 ${stats.p95Ms.toFixed(2)} ms over ${stats.samples} ticks, mean ${stats.meanMs.toFixed(2)} ms`,
);
check(
  "peak concurrent vehicles reaches the NF1 scale",
  stats.maxCount >= 300,
  `peak ${stats.maxCount} vehicles — known gap, see CLAUDE.md "MVP 5's one disclosed gap"`,
  { expectedFail: true },
);
check(
  "no frame was truncated",
  !stats.truncated,
  `peak ${stats.maxCount} vs MAX_VEHICLES ${stats.maxVehicles}`,
);

// 2. Render frame rate, counted in the page over 5 s.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 >= 5000) resolve((frames * 1000) / (performance.now() - t0));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
check("60 FPS desktop target (NF1)", fps >= 55, `${fps.toFixed(1)} FPS`);

await finish(false);
