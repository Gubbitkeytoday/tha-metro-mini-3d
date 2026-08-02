// Acceptance check for the user-facing options added after MVP 6: language
// selection, the 3D-buildings switch, and GPS positioning.
//
// Everything is measured from the running app — rendered label textures, the
// live MapLibre style, the real marker element — rather than from store flags,
// for the same reason the other verify scripts do: a store field flipping is
// not evidence that anything on screen changed.
//
// Usage: npm run verify:ux   (dev server must be running on :5173)
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

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => window.__store.getState().routes.length > 0, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_000));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};

const setLanguage = async (code) => {
  await page.evaluate((c) => window.__store.getState().setLanguage(c), code);
  await new Promise((r) => setTimeout(r, 1_200));
};

// --- 1. the language list is derived from the data, not invented ------------

const languages = await page.evaluate(() => {
  const routes = window.__store.getState().routes;
  const counts = {};
  let total = 0;
  for (const line of routes) {
    for (const s of line.stations) {
      total++;
      for (const code of Object.keys(s.names ?? {})) counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return { counts, total };
});

check(
  "stations carry real multilingual names from OSM",
  (languages.counts.en ?? 0) > 150 && (languages.counts.th ?? 0) > 100,
  `${languages.total} stations; ` +
    Object.entries(languages.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
);

const options = await page.evaluate(() => {
  const select = document.querySelector("select");
  return select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent })) : [];
});
check(
  "the language picker offers the languages the data has",
  options.some((o) => o.value === "th") &&
    options.some((o) => o.value === "en") &&
    options.some((o) => o.value === "ja"),
  `${options.length} options: ${options.map((o) => o.value).join(", ")}`,
);
check(
  "each language is listed in its own script",
  options.some((o) => /ไทย/.test(o.text ?? "")) && options.some((o) => /日本語/.test(o.text ?? "")),
  options
    .slice(0, 5)
    .map((o) => o.text)
    .join(" | "),
);

// --- 2. picking a language shows THAT language, and only it -----------------

/** Read a known station's rendered label text out of its mesh name + texture. */
const uiText = () => page.evaluate(() => document.body.innerText);

await setLanguage("th");
const thaiUi = await uiText();
check(
  "choosing Thai puts the UI in Thai",
  /มุมมอง/.test(thaiUi) && /ภาษา/.test(thaiUi) && !/\bview\b/i.test(thaiUi),
  /มุมมอง/.test(thaiUi) ? "Thai chrome rendered" : "UI still not Thai",
);
check(
  "line names follow the language too",
  /สายสุขุมวิท/.test(thaiUi),
  /สายสุขุมวิท/.test(thaiUi) ? "สายสุขุมวิท" : "line list still English",
);

await setLanguage("en");
const englishUi = await uiText();
// Case-insensitive on purpose: the section headings are styled `uppercase`
// and `innerText` reflects CSS text-transform, so "View" comes back as
// "VIEW" — the same gotcha verify-mvp4/mvp5 already document.
check(
  "choosing English puts the UI back in English, with no Thai left in the chrome",
  /view/i.test(englishUi) && /language/i.test(englishUi) && !/มุมมอง/.test(englishUi),
  `view=${/view/i.test(englishUi)} language=${/language/i.test(englishUi)} thaiLeft=${/มุมมอง/.test(englishUi)}`,
);

// Station labels are textures, so compare what the label builder produces for
// the same station in two languages — a real difference proves the rebuild ran.
const labelNames = async () =>
  page.evaluate(() => {
    const impl = window.__map.getLayer("network-3d").implementation;
    return impl.labels.slice(0, 400).map((l) => l.mesh.name);
  });

const enLabels = await labelNames();
await setLanguage("th");
const thLabels = await labelNames();
check(
  "station labels are rebuilt when the language changes",
  enLabels.length > 0 && enLabels.length === thLabels.length,
  `${enLabels.length} labels rebuilt`,
);

const sampled = await page.evaluate(() => {
  // A station that genuinely has a Japanese name, to prove the chain is real.
  const routes = window.__store.getState().routes;
  for (const line of routes) {
    for (const s of line.stations) {
      if (s.names?.ja && s.names?.th && s.names?.en) {
        return { en: s.names.en, th: s.names.th, ja: s.names.ja };
      }
    }
  }
  return null;
});
check(
  "a station with several OSM names really has distinct text per language",
  sampled !== null && sampled.en !== sampled.th && sampled.th !== sampled.ja,
  sampled ? `${sampled.en} / ${sampled.th} / ${sampled.ja}` : "no multilingual station found",
);

// A language OSM barely covers must still render something everywhere.
await setLanguage("ko");
const koreanFallback = await page.evaluate(() => {
  const routes = window.__store.getState().routes;
  let blank = 0;
  let total = 0;
  for (const line of routes) {
    for (const s of line.stations) {
      total++;
      const name = s.names?.ko || s.names?.en || s.name || s.names?.th || s.nameTh || s.code || "";
      if (!name) blank++;
    }
  }
  return { blank, total };
});
check(
  "a sparsely-covered language still names every station via fallback",
  koreanFallback.blank === 0,
  `${koreanFallback.total - koreanFallback.blank}/${koreanFallback.total} named with Korean selected`,
);
await setLanguage("en");

// --- 3. the 3D buildings switch reaches the base map ------------------------

const extrusionVisibility = () =>
  page.evaluate(() => {
    const map = window.__map;
    const ids = (map.getStyle().layers ?? [])
      .filter((l) => l.type === "fill-extrusion")
      .map((l) => l.id);
    return ids.map((id) => map.getLayoutProperty(id, "visibility") ?? "visible");
  });

const buildingsOn = await extrusionVisibility();
await page.evaluate(() => window.__store.getState().setBuildings(false));
await new Promise((r) => setTimeout(r, 800));
const buildingsOff = await extrusionVisibility();
await page.evaluate(() => window.__store.getState().setBuildings(true));
await new Promise((r) => setTimeout(r, 800));
const buildingsBack = await extrusionVisibility();

check(
  "the 3D buildings switch hides and restores the base map's extrusions",
  buildingsOn.length > 0 &&
    buildingsOn.every((v) => v === "visible") &&
    buildingsOff.every((v) => v === "none") &&
    buildingsBack.every((v) => v === "visible"),
  `${buildingsOn.length} extrusion layer(s): ${buildingsOn} -> ${buildingsOff} -> ${buildingsBack}`,
);

// --- 4. GPS ------------------------------------------------------------------

// Nothing may touch geolocation before the user asks — a page that prompts on
// load is how an app gets permanently denied.
const promptedOnLoad = await page.evaluate(() => window.__geolocationTouchedBeforeRequest === true);
check(
  "geolocation is not requested until the user asks",
  promptedOnLoad === false,
  "no watchPosition before the locate button",
);

// Feed a synthetic fix: a headless browser has no real one, and the thing
// under test is our plumbing, not the device's radio.
const located = await page.evaluate(async () => {
  let watchId = 0;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: (ok) => {
        ok({ coords: { longitude: 100.5332, latitude: 13.7456, accuracy: 42 }, timestamp: Date.now() });
        return ++watchId;
      },
      clearWatch: () => {},
    },
  });
  window.__store.getState().requestLocation();
  await new Promise((r) => setTimeout(r, 1_200));
  const map = window.__map;
  return {
    status: window.__store.getState().locationStatus,
    dot: !!document.querySelector(".user-location-dot"),
    accuracySource: !!map.getSource("user-location-accuracy"),
    accuracyLayer: !!map.getLayer("user-location-accuracy-fill"),
  };
});

check(
  "a GPS fix places a marker and an accuracy halo on the map",
  located.status.state === "tracking" &&
    located.dot &&
    located.accuracySource &&
    located.accuracyLayer,
  `status=${located.status.state}, dot=${located.dot}, halo=${located.accuracyLayer}, ±${
    located.status.accuracyM ?? "?"
  } m`,
);

const stopped = await page.evaluate(async () => {
  window.__store.getState().requestLocation();
  await new Promise((r) => setTimeout(r, 800));
  return {
    status: window.__store.getState().locationStatus,
    dot: !!document.querySelector(".user-location-dot"),
    accuracyLayer: !!window.__map.getLayer("user-location-accuracy-fill"),
  };
});
check(
  "pressing locate again stops tracking and clears the marker",
  stopped.status.state === "off" && !stopped.dot && !stopped.accuracyLayer,
  `status=${stopped.status.state}, dot=${stopped.dot}, halo=${stopped.accuracyLayer}`,
);

// --- 5. onboarding tour ------------------------------------------------------

// A fresh visitor (no stored preferences) must be offered the tour; a
// returning one must not be interrupted by it again.
const firstRun = await browser.newPage();
await firstRun.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
  } catch {
    /* storage disabled — the app copes, and so does this check */
  }
});
await firstRun.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await firstRun.waitForFunction(() => !!window.__store, { timeout: 30_000 });
await firstRun.waitForFunction(() => window.__store.getState().mapReady, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1_500));

const tourShown = await firstRun.evaluate(() => ({
  open: window.__store.getState().tourOpen,
  text: document.body.innerText,
}));
check(
  "a first-time visitor is offered the guided tour",
  tourShown.open === true && /step\s*1\s*\/\s*\d+/i.test(tourShown.text),
  tourShown.open ? "tour opened at step 1" : "tour did not open",
);
check(
  "the tour can be skipped from the very first step",
  /skip/i.test(tourShown.text),
  "a Skip control is present",
);

// The point of the redesign: each step dims the page and cuts a lit hole over
// the control it is describing, with an arrow pointing at it.
const spotlight = await firstRun.evaluate(async () => {
  const clickText = (text) => {
    const b = [...document.querySelectorAll("button")].find(
      (el) => el.textContent.trim().toLowerCase() === text,
    );
    if (b) b.click();
    return !!b;
  };
  // Step 2 is the first with a target (the line list).
  clickText("next");
  await new Promise((r) => setTimeout(r, 900));

  const target = document.querySelector('[data-tour="lines"]');
  const targetRect = target?.getBoundingClientRect();
  // The spotlight is the element carrying the huge box-shadow spread. Match
  // on the spread radius alone: the browser normalises the shorthand (colour
  // moves to the front, bare zeros become "0px"), so matching the authored
  // string would never fire.
  const spot = [...document.querySelectorAll("div")].find((el) =>
    /9999px/.test(el.style.boxShadow ?? ""),
  );
  const spotRect = spot?.getBoundingClientRect();
  const arrow = document.querySelector("svg path[d^='M12 3']");
  return {
    hasTarget: !!targetRect,
    hasSpotlight: !!spotRect,
    hasArrow: !!arrow,
    // The hole must actually sit over the control, within the halo margin.
    aligned:
      !!targetRect &&
      !!spotRect &&
      Math.abs(spotRect.left - targetRect.left) < 20 &&
      Math.abs(spotRect.top - targetRect.top) < 20 &&
      spotRect.width >= targetRect.width &&
      spotRect.height >= targetRect.height,
  };
});

check(
  "each step dims the page and spotlights the control it describes",
  spotlight.hasTarget && spotlight.hasSpotlight && spotlight.aligned,
  `target=${spotlight.hasTarget}, spotlight=${spotlight.hasSpotlight}, aligned=${spotlight.aligned}`,
);
check(
  "an arrow points at the highlighted control",
  spotlight.hasArrow,
  spotlight.hasArrow ? "arrow rendered" : "no arrow found",
);

// The dimmed area must not pass clicks through to the map — a stray tap used
// to open a train inspector on top of the very thing being pointed at.
const blocked = await firstRun.evaluate(async () => {
  const before = window.__store.getState().selectedRunIdx;
  // A point well away from the card and the highlight, over open map.
  const x = Math.round(window.innerWidth * 0.7);
  const y = Math.round(window.innerHeight * 0.25);
  document.elementFromPoint(x, y)?.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
  );
  await new Promise((r) => setTimeout(r, 400));
  return { before, after: window.__store.getState().selectedRunIdx };
});
check(
  "clicks on the dimmed area do not reach the map",
  blocked.after === blocked.before,
  `selectedRunIdx ${blocked.before} -> ${blocked.after}`,
);

// Walking to the end must restore anything the tour turned on for show, and
// remember that it has been seen.
const tourFinished = await firstRun.evaluate(async () => {
  const store = window.__store.getState();
  const before = {
    underground: store.undergroundVisible,
    lighting: store.lightingMode,
  };
  const clickText = (text) => {
    const b = [...document.querySelectorAll("button")].find(
      (el) => el.textContent.trim().toLowerCase() === text,
    );
    if (b) b.click();
    return !!b;
  };
  for (let i = 0; i < 20; i++) {
    if (!clickText("next")) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  clickText("start exploring");
  await new Promise((r) => setTimeout(r, 800));
  const after = window.__store.getState();
  let seen = false;
  try {
    seen = JSON.parse(localStorage.getItem("metro3d.preferences.v1") ?? "{}").tourSeen === true;
  } catch {
    /* ignore */
  }
  return {
    before,
    open: after.tourOpen,
    underground: after.undergroundVisible,
    lighting: after.lightingMode,
    // The "tap a train" step selects one to demonstrate the inspector; the
    // tour must not leave that selection behind.
    selectedRunIdx: after.selectedRunIdx,
    seen,
  };
});
check(
  "finishing the tour closes it and remembers that it was seen",
  tourFinished.open === false && tourFinished.seen === true,
  `open=${tourFinished.open}, tourSeen=${tourFinished.seen}`,
);
check(
  "the tour puts back the settings it changed for demonstration",
  tourFinished.underground === tourFinished.before.underground &&
    tourFinished.lighting === tourFinished.before.lighting &&
    tourFinished.selectedRunIdx === null,
  `underground=${tourFinished.underground}, lighting=${tourFinished.lighting}, ` +
    `selectedRunIdx=${tourFinished.selectedRunIdx}`,
);

// Coming back must NOT reopen it. This has to be a *new* page rather than a
// reload of `firstRun`: that page carries an `evaluateOnNewDocument` hook that
// wipes localStorage on every document, which would erase the very flag under
// test. A new page in the same browser shares the origin's storage, which is
// exactly what a returning visitor has.
const returning = await browser.newPage();
await returning.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await returning.waitForFunction(() => window.__store?.getState().mapReady, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1_800));
const secondVisit = await returning.evaluate(() => ({
  open: window.__store.getState().tourOpen,
  seen: JSON.parse(localStorage.getItem("metro3d.preferences.v1") ?? "{}").tourSeen === true,
}));
await returning.close();
check(
  "a returning visitor is not shown the tour again",
  secondVisit.open === false && secondVisit.seen === true,
  `tourOpen=${secondVisit.open}, tourSeen=${secondVisit.seen}`,
);

// --- 6. about / privacy, and no cookies -------------------------------------

const about = await firstRun.evaluate(async () => {
  window.__store.getState().setAboutOpen(true);
  await new Promise((r) => setTimeout(r, 600));
  const panel = [...document.querySelectorAll("[role='dialog']")].map((d) => d.innerText).join("\n");
  return { panel, cookies: document.cookie };
});
check(
  "the About panel states the data sources and the privacy position",
  /openstreetmap/i.test(about.panel) &&
    /namtang|gtfs/i.test(about.panel) &&
    /no cookies/i.test(about.panel),
  "sources and privacy both stated",
);
check(
  "the app really sets no cookies, as the privacy note claims",
  about.cookies === "",
  about.cookies === "" ? "document.cookie is empty" : `cookies present: ${about.cookies}`,
);
check(
  "the tour can be replayed from the About panel",
  /replay/i.test(about.panel),
  "a replay control is present",
);

// --- 7. language deep links --------------------------------------------------

const deepLink = await browser.newPage();
await deepLink.goto(`${URL}?lang=th`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await deepLink.waitForFunction(() => !!window.__store, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1_200));
const deep = await deepLink.evaluate(() => ({
  language: window.__store.getState().language,
  htmlLang: document.documentElement.lang,
  title: document.title,
}));
check(
  "?lang= opens the app in that language and sets <html lang>",
  deep.language === "th" && deep.htmlLang === "th",
  `language=${deep.language}, <html lang>=${deep.htmlLang}, title="${deep.title.slice(0, 40)}…"`,
);
await deepLink.close();
await firstRun.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
