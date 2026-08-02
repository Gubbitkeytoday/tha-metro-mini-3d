#!/usr/bin/env node
/**
 * Record the demo video (`docs/media/demo.mp4`, `.webm`, and a short `.gif`).
 *
 * ## How it captures
 *
 * Frames come from CDP `Page.startScreencast`, and **each frame's own
 * timestamp is kept**. A screencast does not deliver at a fixed rate — it
 * skips while the GPU is busy and bursts when it is not — so assembling the
 * frames at an assumed fps produces a video that speeds up and slows down
 * against reality. Instead the frames are written to an ffmpeg concat list with
 * their real durations, and ffmpeg resamples that to constant 30 fps. What you
 * watch is then paced exactly as the app ran.
 *
 * Rendering is CPU (SwiftShader) in headless, so the capture is slower than
 * real time on some machines; because pacing comes from timestamps rather than
 * frame count, that shows up as a lower frame rate, never as the wrong speed.
 *
 * ## How it is directed
 *
 * A list of scenes, each with a duration, an optional caption and a setup
 * function. Camera moves use the map's own `easeTo`/`flyTo` so the motion is
 * the app's, not an interpolation invented here. Captions are injected by this
 * script into a DOM overlay — they are part of the video, not part of the app.
 *
 * Usage: npm run media:video   (dev server must be running on :5173)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const URL_BASE = process.argv[2] ?? "http://localhost:5173/";
const OUT_DIR = resolve(import.meta.dirname, "../docs/media");
const FRAME_DIR = resolve(import.meta.dirname, "../.video-frames");
const FPS = 30;

mkdirSync(OUT_DIR, { recursive: true });
rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run", "--hide-scrollbars"],
  // 1280x720 rather than 1080p: SwiftShader has to draw every pixel on the CPU,
  // and 720p is the difference between a capture that keeps up and one that
  // crawls. Upscaling in ffmpeg would add nothing real.
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("metro3d.preferences.v1", JSON.stringify({ tourSeen: true }));
  } catch {
    /* storage unavailable — the tour would appear in the recording */
  }
});
await page.goto(`${URL_BASE}?lang=en`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__map && !!window.__store && !!window.__sim?.current, {
  timeout: 30_000,
});
await page.waitForFunction(() => window.__store.getState().stations.length > 0, { timeout: 30_000 });

// Pin the clock to the evening peak, so the recording has the most trains on
// it and is the same scene every time it is re-recorded.
await page.evaluate(() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 4) % 7)); // Wednesday: weekday service
  d.setHours(17, 40, 0, 0);
  window.__sim.current.setClock(d.getTime(), 1);
});
await page.waitForFunction(() => window.__store.getState().vehicleCount > 50, { timeout: 20_000 });

/**
 * Show a caption, creating the overlay if it is not there.
 *
 * Written to be idempotent rather than installed once at start-up: a run that
 * installed the helper up front died four scenes in with "window.__caption is
 * not a function", and a recording that throws two thirds of the way through is
 * a recording thrown away. Re-creating the node costs nothing and cannot fail
 * that way.
 *
 * `pointer-events: none` so the overlay can never intercept the clicks the
 * scenes make on the real UI.
 */
const caption = (text) =>
  page.evaluate((value) => {
    let node = document.getElementById("video-caption");
    if (!node) {
      node = document.createElement("div");
      node.id = "video-caption";
      node.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:96px",
        "transform:translateX(-50%)",
        "max-width:min(760px,86vw)",
        "padding:10px 20px",
        "border-radius:999px",
        "background:rgba(15,23,42,0.82)",
        "color:#f8fafc",
        "font:500 17px/1.45 ui-sans-serif,system-ui,'Segoe UI',sans-serif",
        "text-align:center",
        "letter-spacing:0.01em",
        "backdrop-filter:blur(8px)",
        "box-shadow:0 8px 30px rgba(0,0,0,0.35)",
        "opacity:0",
        "transition:opacity 420ms ease",
        "pointer-events:none",
        "z-index:99999",
      ].join(";");
      document.body.appendChild(node);
    }
    if (!value) {
      node.style.opacity = "0";
      return;
    }
    node.textContent = value;
    node.style.opacity = "1";
  }, text);



/**
 * The choreography.
 *
 * `ms` is how long the scene is held *after* its setup runs, which is what
 * gives each camera move room to finish. Every move uses the map's own easing
 * so the video shows the app's motion rather than a stand-in.
 */
const scenes = [
  {
    ms: 4_500,
    caption: "Greater Bangkok Metro Mini 3D — ten lines, 193 stations, on schedule",
    async run() {
      await page.evaluate(() =>
        window.__map.jumpTo({ center: [100.545, 13.755], zoom: 11.1, pitch: 50, bearing: -18 }),
      );
    },
  },
  {
    ms: 9_000,
    caption: "Every train placed from the published timetable — 195 of them at the evening peak",
    async run() {
      // A slow orbit of the whole region. One long easeTo rather than a loop of
      // small jumps: MapLibre's own easing is smoother than anything stepped
      // frame by frame from outside.
      await page.evaluate(() =>
        window.__map.easeTo({ bearing: 26, pitch: 58, zoom: 11.4, duration: 8_500 }),
      );
    },
  },
  {
    ms: 7_000,
    caption: "Down to street level: each fleet carries its own line's livery",
    async run() {
      await page.evaluate(() => {
        const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
        for (let i = 0; i < count; i++) {
          const b = i * 8;
          if (vehicles[b + 4] !== 1) continue;
          const { lng, lat } = window.__localToLngLat(vehicles[b], vehicles[b + 1]);
          window.__map.flyTo({ center: [lng, lat], zoom: 18.2, pitch: 62, duration: 5_000 });
          return;
        }
      });
    },
  },
  {
    ms: 8_000,
    caption: "Tap a train to inspect it — and the camera can ride along",
    async run() {
      await page.evaluate(() => {
        const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
        for (let i = 0; i < count; i++) {
          const b = i * 8;
          if (vehicles[b + 4] !== 1) continue;
          const s = window.__store.getState();
          s.selectRun(vehicles[b + 5]);
          s.setFollowing(true);
          return;
        }
      });
    },
  },
  {
    ms: 7_000,
    caption: "Run the clock at 60× and the whole network moves",
    async run() {
      await page.evaluate(() => {
        const s = window.__store.getState();
        s.setFollowing(false);
        s.selectRun(null);
        window.__map.flyTo({ center: [100.5405, 13.748], zoom: 13.2, pitch: 62, duration: 3_000 });
        window.__sim.current.setWarp(60);
      });
    },
  },
  {
    ms: 8_000,
    caption: "See-through tunnels: MRT Blue's underground core, drawn through the city above it",
    async run() {
      await page.evaluate(() => {
        window.__sim.current.setWarp(1);
        window.__store.getState().setUndergroundVisible(true);
        window.__map.flyTo({
          center: [100.5155, 13.7395],
          zoom: 16.0,
          pitch: 78,
          bearing: -64,
          duration: 5_000,
        });
      });
    },
  },
  {
    ms: 7_000,
    caption: "Lighting follows the simulated clock — scrub to the evening and the sun sets",
    async run() {
      await page.evaluate(() => {
        window.__store.getState().setUndergroundVisible(false);
        window.__map.flyTo({
          center: [100.5405, 13.7465],
          zoom: 13.2,
          pitch: 64,
          bearing: -14,
          duration: 3_500,
        });
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 4) % 7));
        d.setHours(20, 20, 0, 0);
        window.__sim.current.setClock(d.getTime(), 1);
      });
    },
  },
  {
    ms: 11_000,
    caption: "New in town? Search any station in any language, and be told where to change",
    async run() {
      await page.evaluate(() => {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 4) % 7));
        d.setHours(17, 40, 0, 0);
        window.__sim.current.setClock(d.getTime(), 1);
        window.__map.flyTo({ center: [100.5405, 13.7465], zoom: 12.4, pitch: 56, duration: 2_500 });
      });
      await sleep(2_600);
      await page.click('[data-tour="planner"]');
      await page.waitForSelector('div[data-panel="planner"] input[type="search"]');
      const type = async (text) => {
        const input = await page.$('div[data-panel="planner"] input[type="search"]');
        await input.click();
        await page.keyboard.down("Control");
        await page.keyboard.press("KeyA");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        // Typed slowly on purpose: the point of the scene is that a viewer can
        // read the query and the results appearing under it.
        await input.type(text, { delay: 110 });
      };
      await type("mo chit");
      await sleep(900);
      await page.click('div[data-panel="planner"] ul li button:first-child');
      await sleep(700);
      await type("suvarna");
      await sleep(900);
      await page.click('div[data-panel="planner"] ul li button:first-child');
    },
  },
  {
    ms: 6_500,
    caption: "Free, open source, no accounts and no tracking — metro.itstom.me",
    async run() {
      await page.evaluate(() => {
        window.__store.getState().setPlannerOpen(false);
        window.__map.flyTo({
          center: [100.545, 13.755],
          zoom: 11.1,
          pitch: 50,
          bearing: -18,
          duration: 5_000,
        });
      });
    },
  },
];

// ---- capture -----------------------------------------------------------------

const client = await page.createCDPSession();
const frames = [];
client.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  frames.push({ data, timestamp: metadata.timestamp });
  try {
    await client.send("Page.screencastFrameAck", { sessionId });
  } catch {
    /* capture already stopped */
  }
});

console.log("recording…");
await client.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

for (const [i, scene] of scenes.entries()) {
  await caption(scene.caption);
  await scene.run();
  await sleep(scene.ms);
  console.log(`  scene ${i + 1}/${scenes.length}: ${scene.caption.slice(0, 52)}…`);
}
await caption("");
await sleep(600);

await client.send("Page.stopScreencast");
await browser.close();
console.log(`captured ${frames.length} frames`);

if (frames.length < 30) {
  console.error("too few frames captured to build a video");
  process.exit(1);
}

// ---- assemble ----------------------------------------------------------------

const list = [];
for (const [i, frame] of frames.entries()) {
  const name = `f${String(i).padStart(5, "0")}.jpg`;
  writeFileSync(resolve(FRAME_DIR, name), Buffer.from(frame.data, "base64"));
  // Concat-demuxer duration for this frame = gap to the next one. The final
  // frame has no successor, so it gets the nominal frame time.
  const next = frames[i + 1];
  const duration = next ? Math.max(1 / 240, next.timestamp - frame.timestamp) : 1 / FPS;
  list.push(`file '${name}'`, `duration ${duration.toFixed(6)}`);
}
// The concat demuxer ignores the last entry's duration unless the file is
// repeated, which is why the final frame is listed twice.
list.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
writeFileSync(resolve(FRAME_DIR, "frames.txt"), `${list.join("\n")}\n`);

const seconds = frames.at(-1).timestamp - frames[0].timestamp;
console.log(`assembling ${seconds.toFixed(1)}s at ${(frames.length / seconds).toFixed(1)} captured fps`);

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });

const concatIn = ["-f", "concat", "-safe", "0", "-i", resolve(FRAME_DIR, "frames.txt")];

// H.264 in MP4: the only combination that plays inline everywhere, including
// GitHub's own player and iOS. `yuv420p` is not optional for that — the
// screencast frames are yuvj420p and Safari refuses the full-range variant.
ffmpeg([
  ...concatIn,
  "-vsync",
  "cfr",
  "-r",
  String(FPS),
  "-c:v",
  "libx264",
  "-preset",
  "slower",
  "-crf",
  "27",
  "-pix_fmt",
  "yuv420p",
  // A map with fine linework needs its keyframes; -g 60 keeps seeking cheap.
  "-g",
  "60",
  "-movflags",
  "+faststart",
  resolve(OUT_DIR, "demo.mp4"),
]);
console.log("wrote docs/media/demo.mp4");

// No WebM. H.264 in MP4 plays inline in GitHub's own player, in every browser
// in the support matrix and on iOS; a second 30 MB encode of the same 91
// seconds would earn the repository nothing.

// A short looping GIF for the top of the README: GitHub autoplays a GIF but
// requires a click to play a video, so the first thing a visitor sees should
// move on its own. Held to the opening orbit at 10 fps and 640 px — a
// full-length GIF of this runs to tens of megabytes, and a README that takes 18
// MB to open is worse than one with a still. Even at 11 s / 10 fps / 640 px it
// came to 7.9 MB, hence the current 9 s / 8 fps / 560 px.
ffmpeg([
  "-i",
  resolve(OUT_DIR, "demo.mp4"),
  "-t",
  "9",
  "-vf",
  "fps=8,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
  "-loop",
  "0",
  resolve(OUT_DIR, "demo.gif"),
]);
console.log("wrote docs/media/demo.gif");

rmSync(FRAME_DIR, { recursive: true, force: true });
console.log("done");
