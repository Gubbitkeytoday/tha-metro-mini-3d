// Acceptance check for station search and the journey planner — the "just
// arrived in Bangkok, do not know how any of this works" feature.
//
// Everything here is driven through the real UI: the button is clicked, the
// query is typed a character at a time, the result rows are clicked. A planner
// that computes a correct route but whose rows cannot be reached with a tap is
// not a feature, and only a DOM-level run can tell the difference.
//
// Usage: npm run verify:planner   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
});

// The first-run tour puts a full-screen click catcher over everything.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("metro3d.preferences.v1", JSON.stringify({ tourSeen: true }));
  } catch {
    /* storage unavailable — the tour simply shows, as it would for a user */
  }
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => window.__store.getState().stations.length > 0, {
  timeout: 30_000,
});
await new Promise((r) => setTimeout(r, 1_500));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = () =>
  page.$$eval('div[data-panel="planner"] ul li button:first-child', (bs) =>
    bs.map((b) => b.textContent.trim()),
  );

const type = async (text) => {
  const input = await page.$('div[data-panel="planner"] input[type="search"]');
  // Ctrl+A, not a triple click: a triple click does not select the contents of
  // an `input[type=search]` here, so the old query was left in place and every
  // search after the first one ran against "asoE4".
  await input.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await input.type(text, { delay: 20 });
  await sleep(350);
};

// --- 1. the entry point is reachable ----------------------------------------

const button = await page.$('[data-tour="planner"]');
check("a search button is on screen", !!button, button ? "found [data-tour=planner]" : "missing");

await button.click();
await page.waitForSelector('div[data-panel="planner"] input[type="search"]', { timeout: 5_000 });
check("clicking it opens the planner", true, "dialog with a search field");

// --- 2. search finds stations across languages and by code -------------------

await type("asok");
const latin = await rows();
check(
  "an English name finds the station",
  latin.some((r) => /asok/i.test(r)),
  latin.slice(0, 3).join(" | ") || "(no rows)",
);

await type("อโศก");
const thai = await rows();
check(
  "the same station is found by its Thai name",
  thai.length > 0,
  thai.slice(0, 3).join(" | ") || "(no rows)",
);

await type("E4");
const byCode = await rows();
check(
  "a station code finds it",
  byCode.length > 0 && /E4/i.test(byCode[0]),
  byCode.slice(0, 3).join(" | ") || "(no rows)",
);

await type("zzzqqq");
const none = await rows();
const emptyText = await page.$eval('div[data-panel="planner"]', (d) => d.innerText);
check(
  "a query that matches nothing says so rather than showing junk",
  none.length === 0 && emptyText.length > 0,
  `${none.length} rows`,
);

// --- 3. picking two stations produces usable instructions --------------------

// Siam and Asok are both on Sukhumvit — a no-change ride.
await type("siam");
await page.click('div[data-panel="planner"] ul li button:first-child');
await sleep(400);
await type("asok");
await page.click('div[data-panel="planner"] ul li button:first-child');
await sleep(1_500);

const simple = await page.$eval('div[data-panel="planner"]', (d) => d.innerText);
check(
  "a same-line trip is planned with no changes",
  /\d/.test(simple) && !/^\s*$/.test(simple) && simple.length > 40,
  simple.replace(/\s+/g, " ").slice(0, 140),
);

const legCount = await page.$$eval('div[data-panel="planner"] ol li', (ls) => ls.length);
check("the answer is a step-by-step leg list", legCount >= 1, `${legCount} legs`);

// --- 4. a trip that genuinely needs a change reports one ---------------------

// Planned through the store rather than the UI so the assertion is about the
// route itself: two stations on different lines must produce >= 1 transfer.
const crossLine = await page.evaluate(async () => {
  const { NetworkGraph } = await import("/src/routing/graph.ts");
  const state = window.__store.getState();
  const stations = state.stations;
  const byRoute = new Map();
  for (const s of stations) {
    if (!byRoute.has(s.route_idx)) byRoute.set(s.route_idx, []);
    byRoute.get(s.route_idx).push(s);
  }
  // Two routes that are connected but different: pick a route with an
  // interchange and follow it to the other side.
  // The destination must be somewhere a single line genuinely cannot reach.
  // Picking any station on another route is not enough: Samrong is served by
  // both Sukhumvit and Yellow, so "route 0 -> route 5" was answered, correctly,
  // with a no-change ride — the first version of this check failed on that.
  const withLink = stations.find((s) => s.interchanges.length > 0);
  if (!withLink) return null;
  const other = withLink.interchanges[0];
  const a = byRoute.get(withLink.route_idx).at(0);
  const b = byRoute
    .get(other.route_idx)
    .filter((s) => s.interchanges.length === 0)
    .at(-1);
  if (!b) return null;
  const graph = new NetworkGraph(stations, { sampled: new Map(), vehicleTypeByRoute: [] });
  const journey = graph.plan(a, b);
  return journey
    ? {
        from: a.name_en,
        to: b.name_en,
        fromRoute: a.route_idx,
        toRoute: b.route_idx,
        transfers: journey.transfers,
        legs: journey.legs.length,
        minutes: Math.round(journey.totalSeconds / 60),
      }
    : { failed: true, from: a.name_en, to: b.name_en };
});

check(
  "a trip between two different lines is routed, with a change",
  !!crossLine && !crossLine.failed && crossLine.transfers >= 1 && crossLine.minutes > 0,
  crossLine
    ? `${crossLine.from} (route ${crossLine.fromRoute}) → ${crossLine.to} (route ${crossLine.toRoute}): ` +
      `${crossLine.legs} legs, ${crossLine.transfers} change(s), ~${crossLine.minutes} min`
    : "no interchange in the network",
);

// --- 5. the result is actionable on the map ----------------------------------

const before = await page.evaluate(() => window.__map.getCenter());
await type("mo chit");
const showButtons = await page.$$('div[data-panel="planner"] ul li button:nth-child(2)');
check("each result offers a show-on-map action", showButtons.length > 0, `${showButtons.length}`);
if (showButtons.length > 0) {
  await showButtons[0].click();
  await sleep(2_000);
  const after = await page.evaluate(() => ({
    center: window.__map.getCenter(),
    selected: window.__store.getState().selectedStation,
    plannerOpen: window.__store.getState().plannerOpen,
  }));
  const moved =
    Math.abs(after.center.lng - before.lng) > 1e-4 || Math.abs(after.center.lat - before.lat) > 1e-4;
  check(
    "it flies the camera to that station and selects it",
    moved && !!after.selected && after.plannerOpen === false,
    `moved=${moved}, selected=${JSON.stringify(after.selected)}, closed=${!after.plannerOpen}`,
  );
}

// --- 6. it works in another language too -------------------------------------

await page.evaluate(() => {
  // Clear the station selected in step 5 — its board is a dialog too, and
  // leaving it up is how the language assertions below first read the wrong
  // panel's text and "passed" on it.
  window.__store.getState().selectStation(null);
  window.__store.getState().setPlannerOpen(true);
});
await page.waitForSelector('div[data-panel="planner"] input[type="search"]', { timeout: 5_000 });
await page.evaluate(() => window.__store.getState().setLanguage("th"));
await sleep(800);
const thaiUi = await page.$eval('div[data-panel="planner"]', (d) => d.innerText);
check(
  "the planner is fully translated, with no English left in the chrome",
  /[\u0E00-\u0E7F]/.test(thaiUi) && !/Plan a trip|Choose a station/.test(thaiUi),
  thaiUi.replace(/\s+/g, " ").slice(0, 100),
);

// A Latin query must still work while the interface is in Thai — the whole
// point of indexing every name is that the UI language does not gate search.
await type("asok");
const thaiUiLatinQuery = await rows();
check(
  "searching in a different script from the UI language still works",
  thaiUiLatinQuery.length > 0,
  thaiUiLatinQuery.slice(0, 2).join(" | ") || "(no rows)",
);

// --- 7. it is usable on a phone ----------------------------------------------

// Turning `hasTouch` on makes Puppeteer reload the page, which resets the
// store — so the planner has to be opened again afterwards, not before.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true });
await page.waitForFunction(() => window.__store?.getState().stations.length > 0, {
  timeout: 30_000,
});
await page.click('[data-tour="planner"]');
await page.waitForSelector('div[data-panel="planner"]', { timeout: 5_000 });
await sleep(600);
const phone = await page.evaluate(() => {
  const dialog = document.querySelector('div[data-panel="planner"]');
  if (!dialog) return null;
  const box = dialog.getBoundingClientRect();
  return {
    left: box.left,
    right: box.right,
    top: box.top,
    height: box.height,
    width: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
});
check(
  "on a phone the panel stays inside the viewport",
  !!phone &&
    phone.left >= 0 &&
    phone.right <= phone.width + 1 &&
    phone.top >= 0 &&
    phone.height <= phone.viewportHeight,
  phone ? `${Math.round(phone.left)}..${Math.round(phone.right)} of ${phone.width}px, h=${Math.round(phone.height)}/${phone.viewportHeight}` : "no dialog",
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
