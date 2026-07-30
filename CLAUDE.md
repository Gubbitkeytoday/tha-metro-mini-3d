# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**MVP 1–3 delivered** (2026-07-30): BTS Green Line elevated 3D track over MapLibre (MVP 1), Rust GTFS preprocessor → 123 KB binary cache with client-side validation (MVP 2), and scheduled trains moving via a Wasm interpolation engine in a Web Worker with 1×/5×/10×/60× time-warp (MVP 3). Next: MVP 4 (follow-camera, inspectors, time scrubber).

The full design record is [`docs/SRS.md`](./docs/SRS.md) (versioned SRS, v1.0.0). Read §3A before writing any code that touches the MapLibre↔Three.js bridge, the Worker/Wasm boundary, or the serialization format — those decisions are deliberate and expensive to reverse.

## Commands

Node.js is required but **not on the system PATH** on this machine — a portable install lives at `%LOCALAPPDATA%\node-portable\node-v22.14.0-win-x64`; prepend it to `PATH` before running npm/node commands.

- `npm run dev` — Vite dev server (<http://localhost:5173>)
- `npm run build` — `tsc -b` type-check + production build (keep gzip total ≤ 5 MB, SRS NF2)
- `npm run preview` — serve the production build
- `npm run data:fetch` — regenerate `src/data/green-line.json` track geometry from OSM Overpass (mirror fallback + User-Agent handled inside `tools/fetch-green-line.mjs`)
- `node tools/extract-stations.mjs <extracted-gtfs-dir>` — merge official station coords from the Namtang GTFS feed (download: <https://namtang-api.otp.go.th/download/namtang-gtfs.zip>)
- `node tools/screenshot.mjs [url] [outDir]` — headless-Edge screenshots from several camera poses (uses `puppeteer-core`, installed with `--no-save`; in dev builds the map instance is exposed as `window.__map` for this)

Rust toolchain (`stable-x86_64-pc-windows-gnu` — chosen because no MSVC build tools exist on this machine; plus `wasm32-unknown-unknown`, wasm-pack 0.13.1) lives at `%USERPROFILE%\.cargo\bin`, also **not on PATH**:

- `cargo test` (in `rust-engine/`) — 15 sim-core/preprocessor unit tests
- `cargo run -p preprocessor --release -- --gtfs <extracted-gtfs-dir> --track src/data/green-line.json --out public/data/green-line.tmb --report public/data/green-line.report.json` — regenerate the binary timetable cache
- `wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg` — rebuild the Wasm engine (the built `src/sim/pkg/` and `public/data/green-line.tmb` are **committed**, so plain `npm run dev` works without a Rust toolchain; delete wasm-pack's generated `src/sim/pkg/.gitignore` if it reappears — it contains `*`)
- `node tools/verify-kinematics.mjs` / `node tools/verify-closeup.mjs` — data-level motion assertions / camera-on-a-train screenshot against the dev server (dev exposes `window.__sim` for these)

## Git conventions

- Do **not** add a `Co-Authored-By: Claude` (or any AI co-author) trailer to commit messages.

## Implementation notes (learned in MVP 1 — read before touching the map/3D code)

- **Floating origin lives in `src/map/coordinates.ts`** — all Three geometry is built in a local east/north/up meter frame around Siam (`ORIGIN_LNG_LAT`); `ThreeLayer.ts` folds the float64 origin translation + mercator meter scale into the camera projection matrix each frame. Never put absolute mercator values into vertex data.
- **MapLibre's stylesheet forces `.maplibregl-map { position: relative }`**, overriding Tailwind's `absolute` on the container — size the map container with `h-full w-full`, not `absolute inset-0`, or it collapses to 0 height (silently: you get a 300px default canvas and a blank map).
- **Metric-width geometry disappears at low zoom.** The 9 m track deck is subpixel below ~z13, so each branch also gets a constant-pixel-width `Line2`/`LineMaterial` centerline (`buildTrackLine`); its `resolution` uniform must be updated per frame in `ThreeLayer.render()`.
- **Base map is OpenFreeMap's Liberty style** (`https://tiles.openfreemap.org/styles/liberty`) — vector tiles, free, no API key, includes 3D building extrusions that correctly depth-occlude the track.
- **Data provenance:** track geometry = OSM route relations 444651 (Sukhumvit) + 2067854 (Silom) via Overpass, ODbL; station coords = Namtang GTFS `route_id` 1 & 2, CC-BY 4.0. Both attributions render in the map's attribution control — keep them.
- **maplibre-gl is on v6.** The v4→v6 migration touched four things, all load-bearing: `render()` now takes `(gl, options)` and the mercator→clip matrix comes from `options.defaultProjectionData.mainMatrix`; there is **no default export** (named imports only); GL context flags moved from `MapOptions` into `canvasContextAttributes`; and v6 locates its tile worker via `new URL(\`./${name}\`, import.meta.url)` — a dynamic specifier no bundler can rewrite, so `MapContainer.tsx` must call `setWorkerUrl()` with a `?worker&url` import. **Without that call the base map goes silently blank** (style loads, tiles never parse) while the Three layer keeps drawing — so a screenshot that shows track but no buildings means the worker URL broke.
- **Camera input is custom** (`src/map/cameraControls.ts`) — it calls `map.dragRotate.disable()` and owns rotation entirely. Middle-drag, right-drag and ctrl+left-drag all **orbit**: vertical pitches, horizontal turns, applied together in one `jumpTo` so a diagonal drag does both. Directions and rates match MapLibre's (`-0.5 * dy`, `+0.8 * dx`); the reasons for replacing `dragRotate` rather than using it are that it has no middle-button binding and its rotation is anchored to the press point, so bearing response varies with where you clicked. Pan and scroll-zoom are left to MapLibre untouched. Verify with `npm run verify:camera`.

## Implementation notes (learned in MVP 2/3 — engine & pipeline)

- **`docs/ENGINE_CONTRACT.md` is the interface spec** for the cache format, stride-8 `Float32Array` vehicle buffer, worker protocol, and wasm API. Update it when any of those change — it's what keeps the Rust and TS sides in sync.
- **The Namtang feed is frequency-based for BTS**: routes 1/2 have 14 trip *patterns* with relative `stop_times` (starting 00:00:00) expanded via `frequencies.txt` headway windows (06:00–24:00). The preprocessor (`rust-engine/preprocessor`) expands them into ~2,162 concrete runs. Service 1 = weekdays, 2 = weekends, with 42 Thai-holiday `calendar_dates` exceptions.
- **MapLibre's earth radius is 6371008.8 m** (`src/geo/lng_lat.ts`), NOT the WGS84 circumference — `sim-core/src/geo.rs` replicates MapLibre's exact math so Rust ENU output matches `src/map/coordinates.ts` to sub-millimeter (unit-tested). Don't "fix" it to 40075016.686.
- **Engine positions are a pure function of time** (no integration): worker evaluates at 10 Hz into pooled transferable buffers (3-buffer ping-pong, never allocates on the frame path); `SimClient.getInterpolated` lerps the two latest frames matched by `run_idx`. Per-frame data never touches React/Zustand.
- **Trains are 2 draw calls total**: one merged vertex-colored geometry per route in `VehicleManager` (InstancedMesh, capacity 512). Keep it that way as lines are added (SRS §3A.5).
- Bangkok time = UTC+7 fixed (no DST); the worker splits `simEpochMs + 7 h` into `date_yyyymmdd` + `sec_of_day` via UTC getters, and the engine also evaluates the *previous* service day at `sec+86400` for post-midnight spillover.
- Kheha (stop 13608) snaps 63.9 m from the OSM track end — genuine terminus geometry offset, under the 150 m hard limit; every other stop snaps < 40 m.

## What this project is

Greater Bangkok Metro Mini 3D is a web-based 3D visualization of Bangkok's rail transit network (BTS, MRT, SRT, Airport Rail Link), inspired by Mini Tokyo 3D. Trains are placed on 3D track by **interpolating static GTFS timetables** — there is no live vehicle feed (GTFS-Realtime is explicitly out of scope for v1.0). The app lets a user scrub to any past/future time and see where trains *should* be per schedule.

## Planned architecture (from the SRS)

The system is three layers plus an offline pipeline:

1. **Data pipeline** (`tools/gtfs_preprocessor/`, Rust CLI) — converts a GTFS ZIP feed into a compact binary cache (target: **< 3 MB compressed**), falling back to OpenStreetMap geometry where `shapes.txt` is coarse or missing. This is offline/build-time only; scraping (if ever used as a fallback) belongs here, never in client runtime.
2. **Simulation core** (`rust-engine/`, Rust → WebAssembly via `wasm-pack`) — parses the binary cache and computes vehicle kinematics. Runs inside a Web Worker, decoupled from the render frame rate (fixed-timestep sim tick; render side interpolates between the two latest sim states).
3. **Frontend** (`src/`, Vite + TypeScript + React 19 + Tailwind + Zustand) — MapLibre GL JS base map with a custom `CustomLayerInterface` WebGL layer that hosts a Three.js scene for 3D track/train rendering.

### Load-bearing design decisions (SRS §3A) — do not casually deviate

- **Worker↔main-thread transfer:** use **transferable `ArrayBuffer`s** via `postMessage`, not `SharedArrayBuffer`. Avoids the COOP/COEP cross-origin-isolation requirement entirely (many static hosts, e.g. GitHub Pages, can't set those headers). Only reconsider `SharedArrayBuffer` if profiling proves transfer overhead matters, and only after confirming header support on the deployment target.
- **Wasm↔JS API shape:** the engine should expose "tick(time) → fills a shared flat `Float32Array`" (one buffer, zero-copy read), not per-vehicle getter calls — the JS↔Wasm boundary crossing, not the math, is the actual bottleneck against the 3 ms/frame budget.
- **Rendering:** use Three.js `InstancedMesh` per vehicle type (one draw call per type), not one mesh per train.
- **Coordinate precision:** adopt a floating-origin / camera-relative coordinate scheme from the start (MVP 1), not as a retrofit — absolute mercator coordinates at city scale cause visible `float32` jitter, especially in follow-camera.
- **MapLibre↔Three bridge:** both must share the *same* WebGL context (don't let Three create its own canvas). Positions go through `MercatorCoordinate.fromLngLat()`; depth/occlusion between MapLibre terrain and the Three layer is the hard part of underground transparency (F3.2) — budget real time for it. `deck.gl` + `MapboxOverlay` is the documented fallback if the bridge becomes a time sink.
- **State ownership:** Zustand holds only UI-derived state (selected train, line filters) — per-frame kinematics must never enter React state, or re-renders thrash.
- **Serialization:** evaluate `rkyv` (zero-copy deserialization) for the binary cache before falling back to Bincode. Reserve MessagePack/Protobuf for any interchange boundary that isn't Rust-to-Rust.
- **Track geometry:** 3D coordinates `[lon, lat, altitude_meters]`; altitude by structure type — underground −12 to −25 m, at-grade +0.5 m, elevated +12 to +22 m. Apply Catmull-Rom/Bézier spline smoothing so curve nodes don't produce abrupt heading changes.
- **Motion model:** status per vehicle at time *t* is dwell / in-transit / inactive based on scheduled arrival/departure times; in-transit progress uses the smoothstep ease `3p² − 2p³` for accel/decel, with heading derived from the track's 3D tangent (see SRS §F2.1–F2.2 for the exact formulas).

### Planned project structure (SRS §6)

```text
rust-engine/          # Rust Wasm simulation core (lib.rs, gtfs_parser.rs, interpolation.rs, spatial.rs)
src/                  # Vite + React frontend
├── assets/           # .glb models, textures, icons
├── components/       # MapContainer, ControlPanel, TrainInspector, TimeScrubber
├── map/              # ThreeLayer.ts (custom MapLibre WebGL layer), VehicleManager.ts, CameraController.ts
├── stores/           # Zustand
└── types/
tools/gtfs_preprocessor/   # Rust CLI: GTFS ZIP -> binary cache
```

## Delivery model — build in this order

The project is scoped as **vertical MVP slices**, not horizontal layers (data → engine → UI). Each MVP is a complete, demoable increment; later MVPs assume earlier ones are done. If asked to implement a feature, place it in the right MVP rather than building ahead of it:

1. **MVP 1 — Green Line track only.** ✅ **Done.** App shell, MapLibre base map, Three.js bridge + floating-origin coordinates, Green Line 3D geometry rendered, free-camera orbit. No trains, no Wasm, no timetable yet. This is deliberately where the hardest integration risk (map↔Three coordinate/depth) gets solved, on the smallest possible surface.
2. **MVP 2 — Green Line data pipeline.** Rust CLI GTFS→binary cache (Green Line only), client-side load/validation, stop-snapping, calendar resolution. Still no motion.
3. **MVP 3 — Green Line trains moving.** Wasm interpolation engine, Web Worker + transferable-buffer transport, `InstancedMesh` trains, basic time-warp (1×/5×/10×/60×).
4. **MVP 4 — Interaction & UI.** Follow-camera, station/vehicle inspector, time scrubber, live timetable drawer. Still Green Line only.
5. **MVP 5 — Multi-line breadth.** Generalize to line-agnostic code; add Purple, ARL, Pink, Yellow, Gold, Red. Line selector UI. Validate toward the 300-concurrent-vehicle performance target.
6. **MVP 6 — Underground + polish.** MRT Blue (underground), MRT Orange as **track geometry only** (pre-revenue — no trains/timetable until it enters service), underground transparency mode, day/night lighting, final bundle/perf hardening.

## Transit coverage & operator status

Nine lines are in scope (BTS Green [Sukhumvit + Silom], MRT Blue, MRT Purple, SRT Red, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, MRT Orange). **MRT Orange is pre-revenue and gets track geometry only** — no simulated trains — until it has a published operational schedule. The operational/pre-revenue classification in both README and SRS is flagged as **unverified, reflecting early-2025 status** — re-check the Orange Line and any newly-opened extensions (Pink Line spur to Muang Thong Thani, Purple Line southern extension) against a current source before relying on it or before public release.

## Non-functional targets worth knowing before optimizing

- 60 FPS desktop / 30+ FPS mobile; Wasm sim tick < 3 ms/frame for up to 300 concurrent active vehicles.
- Initial bundle ≤ 5 MB compressed (including the binary timetable); GLTF models lazy-load with LOD.
- Browser matrix: Chrome 90+, Safari 15+, Firefox 88+, Edge (Chromium) — WebGL 2.0 + WebAssembly baseline.
- OpenStreetMap-derived geometry requires ODbL attribution; any scraped fallback data must respect the source's ToS and is preprocessor-only, never live in the client.
