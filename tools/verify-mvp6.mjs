// MVP 6 acceptance check (SRS §7 MVP 6 DoD): the network has a genuinely
// mixed-structure underground line, tunnels can be seen through on demand, and
// night lighting is a real repaint rather than a dimmed screenshot.
//
// Assertions read the rendered Three scene and the live MapLibre style — not
// the config that was fed into them — for the same reason verify-mvp5.mjs
// reaches into real InstancedMesh geometry: a table saying "this line is
// underground" is not evidence that anything was drawn below ground.
//
// Usage: npm run verify:mvp6   (dev server must be running on :5173)
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

const blueIdx = LINES.findIndex((l) => l.key === "blue");
if (blueIdx === -1) {
  console.log("FAIL no 'blue' line in the registry — MVP 6's underground line is missing");
  await browser.close();
  process.exit(1);
}

// --- 1. MRT Blue is in the registry, simulated, and has trains --------------

const blue = await page.evaluate((idx) => {
  const route = window.__store.getState().routes[idx];
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  let onBlue = 0;
  for (let i = 0; i < count; i++) if (vehicles[i * 8 + 6] === idx) onBlue++;
  return {
    key: route?.key,
    gtfsRouteId: route?.gtfsRouteId,
    stations: route?.stations.length ?? 0,
    onBlue,
  };
}, blueIdx);

check(
  "MRT Blue is registered at its registry index and is simulated",
  blue.key === "blue" && blue.gtfsRouteId !== null,
  `route ${blueIdx} = '${blue.key}', gtfsRouteId ${blue.gtfsRouteId}, ${blue.stations} stations`,
);

// --- 2. the line is genuinely mixed-structure, below AND above ground -------

const profile = await page.evaluate((idx) => {
  const route = window.__store.getState().routes[idx];
  const alts = route.track.map((p) => p[2]);
  const structures = route.trackStructures ?? [];
  const counts = {};
  for (const s of structures) counts[s] = (counts[s] ?? 0) + 1;
  return { min: Math.min(...alts), max: Math.max(...alts), counts };
}, blueIdx);

check(
  "MRT Blue's track runs both below and above ground",
  profile.min < -5 && profile.max > 5,
  `altitude ${profile.min.toFixed(1)}..${profile.max.toFixed(1)} m, ${JSON.stringify(profile.counts)}`,
);

// --- 3. portals ramp rather than teleport ------------------------------------

const biggestStep = await page.evaluate((idx) => {
  const track = window.__store.getState().routes[idx].track;
  let worst = 0;
  for (let i = 1; i < track.length; i++) {
    worst = Math.max(worst, Math.abs(track[i][2] - track[i - 1][2]));
  }
  return worst;
}, blueIdx);

check(
  "no portal is a vertical cliff — altitude changes are ramped",
  // The raw step between tunnel (-18) and viaduct (+15) is 33 m; smoothing
  // must have spread it over many points.
  biggestStep < 10,
  `largest altitude change between adjacent track points: ${biggestStep.toFixed(2)} m`,
);

// --- 4. the scene really contains below-ground deck geometry ----------------

// NB: getLayer() hands back MapLibre's style-layer wrapper — the Three scene
// lives on `.implementation` (the same gotcha verify-mvp5.mjs documents).
const decks = await page.evaluate(() => {
  const impl = window.__map.getLayer("network-3d").implementation;
  const group = impl.scene.children.find((c) => c.name === "line-blue");
  const meshes = group ? group.children.filter((c) => c.isMesh && c.name.startsWith("track-")) : [];
  return meshes.map((m) => {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return { name: m.name, minZ: bb.min.z, maxZ: bb.max.z };
  });
});

const tunnelDecks = decks.filter((d) => d.name.endsWith("-underground"));
const surfaceDecks = decks.filter((d) => !d.name.endsWith("-underground"));
check(
  "MRT Blue renders as separate tunnel and surface deck meshes",
  tunnelDecks.length >= 1 && surfaceDecks.length >= 1,
  `${decks.length} deck meshes: ${decks.map((d) => d.name.replace("track-blue-", "")).join(", ")}`,
);
// Each deck owns the ramp on its side of the portal (adjacent runs share their
// boundary point so the meshes meet), so a tunnel deck legitimately reaches up
// to viaduct height at its ends — asserting `maxZ < 0` would be asserting a
// gap. What must hold is that the tunnel deck descends to real tunnel depth
// and the surface decks climb to real viaduct height.
check(
  "the tunnel deck descends to real tunnel depth",
  tunnelDecks.length > 0 && tunnelDecks.every((d) => d.minZ < -10),
  tunnelDecks.map((d) => `${d.minZ.toFixed(1)}..${d.maxZ.toFixed(1)} m`).join(", "),
);
check(
  "the surface decks rise to real viaduct height",
  surfaceDecks.length > 0 && surfaceDecks.every((d) => d.maxZ > 10),
  surfaceDecks.map((d) => `${d.minZ.toFixed(1)}..${d.maxZ.toFixed(1)} m`).join(", "),
);

// --- 5. underground transparency changes the tunnel materials ---------------

const readTunnelMaterials = () =>
  page.evaluate(() => {
    const impl = window.__map.getLayer("network-3d").implementation;
    const out = [];
    impl.scene.traverse((o) => {
      if (o.isMesh && typeof o.name === "string" && o.name.endsWith("-underground")) {
        out.push({
          transparent: o.material.transparent,
          opacity: o.material.opacity,
          depthTest: o.material.depthTest,
        });
      }
    });
    return out;
  });

const opaque = await readTunnelMaterials();
await page.evaluate(() => window.__store.getState().setUndergroundVisible(true));
await new Promise((r) => setTimeout(r, 600));
const seeThrough = await readTunnelMaterials();

check(
  "see-through tunnels makes below-ground track translucent and depth-test free",
  opaque.length > 0 &&
    opaque.every((m) => !m.transparent && m.opacity === 1 && m.depthTest) &&
    seeThrough.every((m) => m.transparent && m.opacity < 1 && !m.depthTest),
  `${opaque.length} tunnel material(s): opacity ${opaque[0]?.opacity} -> ${seeThrough[0]?.opacity}, ` +
    `depthTest ${opaque[0]?.depthTest} -> ${seeThrough[0]?.depthTest}`,
);

await page.evaluate(() => window.__store.getState().setUndergroundVisible(false));
await new Promise((r) => setTimeout(r, 400));
const restored = await readTunnelMaterials();
check(
  "turning see-through tunnels back off restores opaque, depth-tested track",
  restored.every((m) => !m.transparent && m.opacity === 1 && m.depthTest),
  `opacity ${restored[0]?.opacity}, depthTest ${restored[0]?.depthTest}`,
);

// --- 6. night mode repaints the base map and retunes the 3D lights ----------

const sampleStyle = () =>
  page.evaluate(() => {
    const map = window.__map;
    const layer = (map.getStyle().layers ?? []).find((l) => l.type === "background");
    const impl = map.getLayer("network-3d").implementation;
    let ambient = null;
    impl.scene.traverse((o) => {
      if (o.isAmbientLight) ambient = { hex: o.color.getHex(), intensity: o.intensity };
    });
    return {
      background: layer ? map.getPaintProperty(layer.id, "background-color") : null,
      ambient,
    };
  });

const day = await sampleStyle();
await page.evaluate(() => window.__store.getState().setLightingMode("night"));
await new Promise((r) => setTimeout(r, 1_200));
const night = await sampleStyle();

check(
  "night mode repaints the base map itself, not just an overlay",
  day.background !== null && night.background !== null && day.background !== night.background,
  `background ${JSON.stringify(day.background)} -> ${JSON.stringify(night.background)}`,
);
check(
  "night mode retunes the 3D layer's own lighting",
  day.ambient !== null &&
    night.ambient !== null &&
    (day.ambient.hex !== night.ambient.hex || day.ambient.intensity !== night.ambient.intensity),
  `ambient ${day.ambient?.hex.toString(16)}@${day.ambient?.intensity} -> ` +
    `${night.ambient?.hex.toString(16)}@${night.ambient?.intensity}`,
);

// Toggling back must restore the ORIGINAL colours exactly — the failure mode
// this guards is compounding, where each night/day cycle darkens the map a
// little more because the "restore" value was itself already darkened.
for (const mode of ["day", "night", "day"]) {
  await page.evaluate((m) => window.__store.getState().setLightingMode(m), mode);
  await new Promise((r) => setTimeout(r, 700));
}
const backToDay = await sampleStyle();

check(
  "night mode is exactly reversible across repeated toggles",
  JSON.stringify(backToDay.background) === JSON.stringify(day.background) &&
    backToDay.ambient?.hex === day.ambient?.hex,
  `background ${JSON.stringify(backToDay.background)} (expected ${JSON.stringify(day.background)})`,
);

// --- 7. auto lighting follows the simulated clock (F3.3) --------------------

/** Scrub the sim clock to an hour of the current Bangkok service day. */
const scrubToHour = async (hour) => {
  await page.evaluate((h) => {
    const c = window.__sim.current;
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    c.setClock(day.getTime() + h * 3_600_000, 1);
  }, hour);
  // The lighting tick runs at 1 Hz, so give it more than one period.
  await new Promise((r) => setTimeout(r, 2_200));
};

await page.evaluate(() => window.__store.getState().setLightingMode("auto"));
await scrubToHour(3);
const preDawn = await page.evaluate(() => window.__store.getState().night);
await scrubToHour(12);
const midday = await page.evaluate(() => window.__store.getState().night);
await scrubToHour(21);
const evening = await page.evaluate(() => window.__store.getState().night);

check(
  "auto lighting tracks the simulated clock, not the wall clock",
  preDawn === true && midday === false && evening === true,
  `03:00 night=${preDawn}, 12:00 night=${midday}, 21:00 night=${evening}`,
);

// The sun must actually move, not just flip a boolean.
await scrubToHour(8);
const morningSun = await page.evaluate(() => {
  const impl = window.__map.getLayer("network-3d").implementation;
  let p = null;
  impl.scene.traverse((o) => {
    if (o.isDirectionalLight) p = { x: o.position.x, y: o.position.y, z: o.position.z };
  });
  return p;
});
await scrubToHour(16);
const afternoonSun = await page.evaluate(() => {
  const impl = window.__map.getLayer("network-3d").implementation;
  let p = null;
  impl.scene.traverse((o) => {
    if (o.isDirectionalLight) p = { x: o.position.x, y: o.position.y, z: o.position.z };
  });
  return p;
});
check(
  "the sun crosses the sky from east to west over the day",
  morningSun !== null && afternoonSun !== null && morningSun.x > 0 && afternoonSun.x < 0,
  `08:00 sun x=${morningSun?.x.toFixed(0)}, 16:00 sun x=${afternoonSun?.x.toFixed(0)} (east positive)`,
);

// --- 8. floating station labels (PUBG-style place names) --------------------

const labelState = async () =>
  page.evaluate(() => {
    const impl = window.__map.getLayer("network-3d").implementation;
    const labels = [];
    impl.scene.traverse((o) => {
      if (typeof o.name === "string" && o.name.startsWith("label-")) {
        const r = o.getWorldPosition(new (o.position.constructor)());
        labels.push({ name: o.name, visible: o.visible, z: r.z });
      }
    });
    return { total: labels.length, visible: labels.filter((l) => l.visible).length };
  });

await page.evaluate(() => {
  window.__store.getState().setShowStationLabels(true);
  window.__map.jumpTo({ center: [100.5332, 13.7456], zoom: 13.2, pitch: 58, bearing: -15 });
});
await new Promise((r) => setTimeout(r, 2_000));
const cityView = await labelState();

check(
  "every station has a floating name label",
  cityView.total >= 190,
  `${cityView.total} labels for ${(await page.evaluate(() => window.__store.getState().stations.length))} stations`,
);
check(
  "labels are actually on screen at a city zoom",
  cityView.visible > 10,
  `${cityView.visible} of ${cityView.total} drawn`,
);

// The whole point of the declutter pass: at this zoom most of the network is
// inside the fade band, and drawing all of it would be an unreadable pile.
check(
  "labels are decluttered rather than all drawn at once",
  cityView.visible < cityView.total * 0.6,
  `${cityView.visible}/${cityView.total} drawn (${Math.round((cityView.visible / cityView.total) * 100)}%)`,
);

// No two *visible* labels may substantially overlap on screen. Projected with
// the layer's own local-ENU→clip matrix, the same one it renders with, so this
// measures what is actually drawn rather than re-deriving a camera.
const worstOverlap = await page.evaluate(() => {
  const impl = window.__map.getLayer("network-3d").implementation;
  const canvas = window.__map.getCanvas();
  const m = impl.projection.elements;
  const project = (v) => {
    const w = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15];
    // w <= 0 is behind the camera; the perspective divide there produces
    // mirrored nonsense, which is what made an early version of this check
    // report 50000-pixel "overlaps".
    if (w <= 0) return null;
    return {
      x: (((m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]) / w) * 0.5 + 0.5) * canvas.clientWidth,
      y: (0.5 - ((m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]) / w) * 0.5) * canvas.clientHeight,
    };
  };

  const boxes = [];
  impl.scene.traverse((o) => {
    if (!o.visible || typeof o.name !== "string" || !o.name.startsWith("label-")) return;
    const centre = project(o.position);
    if (!centre) return;
    // Half-height on screen: project a point one label-height above centre.
    const up = o.position
      .clone()
      .add(new o.position.constructor(0, 1, 0).applyQuaternion(o.quaternion).multiplyScalar(o.scale.y / 2));
    const top = project(up);
    if (!top) return;
    const halfH = Math.hypot(top.x - centre.x, top.y - centre.y);
    boxes.push({ name: o.name, x: centre.x, y: centre.y, halfH, halfW: halfH * (o.scale.x / o.scale.y) });
  });

  let worst = null;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = a.halfW + b.halfW - Math.abs(a.x - b.x);
      const oy = a.halfH + b.halfH - Math.abs(a.y - b.y);
      if (ox > 0 && oy > 0) {
        const area = ox * oy;
        if (!worst || area > worst.area) worst = { area, a: a.name, b: b.name, ox, oy };
      }
    }
  }
  return { count: boxes.length, worst };
});

check(
  "no two drawn labels overlap",
  worstOverlap.worst === null,
  worstOverlap.worst
    ? `${worstOverlap.worst.a} vs ${worstOverlap.worst.b} overlap ${worstOverlap.worst.ox.toFixed(0)}×${worstOverlap.worst.oy.toFixed(0)}px`
    : `${worstOverlap.count} labels, none colliding`,
);

// The "before you jump" altitude — the view these labels exist for.
await page.evaluate(() =>
  window.__map.jumpTo({ center: [100.56, 13.79], zoom: 10.4, pitch: 64, bearing: -14 }),
);
await new Promise((r) => setTimeout(r, 2_000));
const regionView = await labelState();
check(
  "labels survive the whole-region view",
  regionView.visible > 5,
  `${regionView.visible} labels drawn from ~34 km up`,
);

await page.evaluate(() => window.__store.getState().setShowStationLabels(false));
await new Promise((r) => setTimeout(r, 600));
const labelsOff = await labelState();
check(
  "turning station names off hides every label",
  labelsOff.visible === 0,
  `${labelsOff.visible} still drawn`,
);
await page.evaluate(() => window.__store.getState().setShowStationLabels(true));

// --- 9. shadow quality toggle (§3A.5) ---------------------------------------

const shadowState = () =>
  page.evaluate(() => {
    const impl = window.__map.getLayer("network-3d").implementation;
    let castingLight = false;
    impl.scene.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) castingLight = true;
    });
    return { mapEnabled: impl.renderer.shadowMap.enabled, castingLight };
  });

const shadowsOff = await shadowState();
await page.evaluate(() => window.__store.getState().setShadows(true));
await new Promise((r) => setTimeout(r, 1_200));
const shadowsOn = await shadowState();

check(
  "the shadow toggle drives the renderer, not just the store",
  !shadowsOff.mapEnabled && shadowsOn.mapEnabled && shadowsOn.castingLight,
  `shadowMap ${shadowsOff.mapEnabled} -> ${shadowsOn.mapEnabled}, light casts ${shadowsOn.castingLight}`,
);

// The shadow pass binds its own framebuffer inside MapLibre's render loop;
// if it failed to restore state the base map would go blank or corrupt.
const mapAliveWithShadows = await page.evaluate(() => ({
  styleLoaded: window.__map.isStyleLoaded(),
  layers: (window.__map.getStyle().layers ?? []).length,
}));
check(
  "the base map still renders with shadows enabled",
  mapAliveWithShadows.styleLoaded && mapAliveWithShadows.layers > 50,
  `style loaded=${mapAliveWithShadows.styleLoaded}, ${mapAliveWithShadows.layers} layers`,
);
await page.evaluate(() => window.__store.getState().setShadows(false));

// --- 10. the existing network did not regress -------------------------------

const routeKeys = await page.evaluate(() => window.__store.getState().routes.map((r) => r.key));
check(
  "every registry line still renders, in registry order",
  routeKeys.length === LINES.length && routeKeys.every((k, i) => k === LINES[i].key),
  `${routeKeys.length} lines: ${routeKeys.join(", ")}`,
);

await finish(false);
