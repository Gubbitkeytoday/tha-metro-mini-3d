// Responsive acceptance check: the app has to be usable on a phone, a
// landscape phone, a tablet, a laptop and a large desktop — not merely "not
// crash" at those sizes.
//
// Every assertion is measured from the real laid-out DOM (bounding boxes,
// computed styles, the map canvas's own size) rather than from class names,
// because a Tailwind class that doesn't exist silently does nothing and would
// pass any test that only checked the markup.
//
// Usage: npm run verify:responsive   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";

/** The device classes the UI claims to support. */
const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844, touch: true, compact: true },
  { name: "phone landscape", width: 844, height: 390, touch: true, compact: false, short: true },
  { name: "tablet portrait", width: 768, height: 1024, touch: true, compact: false },
  { name: "tablet landscape", width: 1024, height: 768, touch: true, compact: false },
  { name: "laptop", width: 1440, height: 900, touch: false, compact: false },
  { name: "desktop", width: 2560, height: 1440, touch: false, compact: false },
  // The narrowest viewport worth supporting; if anything overflows, it does so
  // here first.
  { name: "small phone", width: 320, height: 568, touch: true, compact: true },
];

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};

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

for (const vp of VIEWPORTS) {
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: 1,
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => !!window.__store && !!window.__map, { timeout: 30_000 });
  await page.waitForFunction(() => window.__store.getState().routes.length > 0, {
    timeout: 30_000,
  });
  await new Promise((r) => setTimeout(r, 1_200));

  const label = `${vp.name} ${vp.width}×${vp.height}`;

  // --- the page itself never scrolls sideways --------------------------------
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));
  check(
    `${label}: no page-level overflow`,
    overflow.scrollW <= overflow.clientW + 1 && overflow.scrollH <= overflow.clientH + 1,
    `scroll ${overflow.scrollW}×${overflow.scrollH} vs client ${overflow.clientW}×${overflow.clientH}`,
  );

  // --- the map fills the viewport -------------------------------------------
  const canvas = await page.evaluate(() => {
    const c = window.__map.getCanvas();
    return { w: c.clientWidth, h: c.clientHeight, iw: window.innerWidth, ih: window.innerHeight };
  });
  check(
    `${label}: map canvas fills the viewport`,
    Math.abs(canvas.w - canvas.iw) <= 1 && Math.abs(canvas.h - canvas.ih) <= 1,
    `canvas ${canvas.w}×${canvas.h} vs viewport ${canvas.iw}×${canvas.ih}`,
  );

  // --- every overlay stays inside the viewport ------------------------------
  const strays = await page.evaluate(() => {
    /** The nearest ancestor that scrolls, if any. */
    const scrollParent = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") return p;
      }
      return null;
    };

    const out = [];
    for (const el of document.querySelectorAll("h1, [role='dialog'], input[type='range'], button")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // Content scrolled out of a scroll container is not "off screen" — it is
      // reachable by scrolling, which is the entire point of the container.
      // Only flag it if it is currently *inside* its scroller's visible box
      // and still escapes the viewport.
      const scroller = scrollParent(el);
      if (scroller) {
        const s = scroller.getBoundingClientRect();
        const insideScroller = r.bottom > s.top && r.top < s.bottom;
        if (!insideScroller) continue;
      }

      if (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 24),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        });
      }
    }
    return out;
  });
  check(
    `${label}: no control sits outside the viewport`,
    strays.length === 0,
    strays.length === 0 ? "all controls within bounds" : JSON.stringify(strays.slice(0, 3)),
  );

  // --- the line panel collapses where there is no room, and only there ------
  const panel = await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const card = heading?.closest("div.absolute");
    const toggle = card?.querySelector("button[aria-expanded]");
    return {
      expanded: toggle?.getAttribute("aria-expanded") === "true",
      height: card ? Math.round(card.getBoundingClientRect().height) : null,
    };
  });
  const shouldCollapse = vp.compact || vp.short;
  check(
    `${label}: line panel ${shouldCollapse ? "starts collapsed" : "starts open"}`,
    panel.expanded === !shouldCollapse,
    `aria-expanded=${panel.expanded}, panel ${panel.height}px tall`,
  );

  // The panel must never eat the screen even when open.
  check(
    `${label}: line panel leaves the map visible`,
    panel.height !== null && panel.height <= vp.height * 0.75,
    `${panel.height}px of ${vp.height}px (${Math.round((panel.height / vp.height) * 100)}%)`,
  );

  // --- touch targets are big enough on touch devices ------------------------
  if (vp.touch) {
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("button")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // MapLibre's own zoom/compass controls are its markup, not ours.
        if (el.closest(".maplibregl-ctrl")) continue;
        if (r.height < 32 || r.width < 32) {
          out.push({ text: (el.textContent ?? "").trim().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) });
        }
      }
      return out;
    });
    check(
      `${label}: touch targets are at least 32px`,
      small.length === 0,
      small.length === 0 ? "all buttons ≥32px" : JSON.stringify(small.slice(0, 4)),
    );
  }

  // --- the detail panel is a sheet on phones and a card elsewhere -----------
  const sheet = await page.evaluate(async () => {
    // Wait for the engine to publish a frame with a vehicle in it. Sampling
    // immediately after a viewport change caught an empty buffer roughly one
    // run in ten and failed a check about panel *shape*, which has nothing to
    // do with how quickly the worker warms up.
    let vehicles = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const frame = window.__sim.current.getInterpolated(performance.now());
      if (frame.count > 0) {
        vehicles = frame.vehicles;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!vehicles) return null;
    window.__store.getState().selectRun(vehicles[5]);
    await new Promise((r) => setTimeout(r, 900));
    const el = document.querySelector("[role='dialog']");
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      top: Math.round(r.top),
      width: Math.round(r.width),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

  if (sheet && !sheet.missing) {
    const isFullWidthSheet =
      sheet.left <= 1 && sheet.right >= sheet.vw - 1 && sheet.bottom >= sheet.vh - 1;
    check(
      `${label}: detail panel is a ${vp.compact ? "bottom sheet" : "floating card"}`,
      vp.compact ? isFullWidthSheet : !isFullWidthSheet && sheet.width <= 400,
      `x ${sheet.left}..${sheet.right} of ${sheet.vw}, bottom ${sheet.bottom} of ${sheet.vh}`,
    );
    check(
      `${label}: detail panel leaves some map visible`,
      sheet.top > 0,
      `panel top at ${sheet.top}px`,
    );
    await page.evaluate(() => window.__store.getState().selectRun(null));
  } else {
    check(`${label}: detail panel opens`, false, "no vehicle available to select");
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
