# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**MVP 1–5 delivered** (2026-07-31): BTS Green Line elevated 3D track over MapLibre (MVP 1), Rust GTFS preprocessor → binary cache with client-side validation (MVP 2), scheduled trains moving via a Wasm interpolation engine in a Web Worker with 1×/5×/10×/60× time-warp (MVP 3), click-to-select trains/stations with a follow-camera, train inspector, live station board and time scrubber (MVP 4), and multi-line breadth — a registry-driven, line-agnostic network of 9 simulated lines (Sukhumvit, Silom, Purple, ARL, Pink, Yellow, Gold, SRT Dark/Light Red; 155 stations, 4,481 runs), a line selector, cross-route interchange metadata, and monorail/APM/commuter vehicle models (MVP 5). Next: MVP 6 (underground + polish).

**MVP 5's one disclosed gap:** `npm run verify:perf` passes 4 of 5 NF1 sub-checks, not 5/5 — the sim actually ticks a meaningful number of samples during the measurement window, sim tick (p95 ~0.2–0.3 ms) and frame rate (~100 FPS) are comfortably under budget, and no frame is truncated, but the ≥300-concurrent-vehicle assertion is left **failing on purpose**: the real 9-line network's measured daily peak is 171–172 concurrent vehicles (confirmed independently by both the preprocessor's own per-minute scan and the live harness), not a bug to chase. `MAX_VEHICLES` is 1024, ~6× the measured peak, so there is real headroom; the `>=300` assertion stays as a hard gate rather than being weakened, in case a future denser network (or a bug) regresses concurrency.

The full design record is [`docs/SRS.md`](./docs/SRS.md) (versioned SRS, v1.0.0). Read §3A before writing any code that touches the MapLibre↔Three.js bridge, the Worker/Wasm boundary, or the serialization format — those decisions are deliberate and expensive to reverse.

## Commands

Node.js is required but **not on the system PATH** on this machine — a portable install lives at `%LOCALAPPDATA%\node-portable\node-v22.14.0-win-x64`; prepend it to `PATH` before running npm/node commands.

- `npm run dev` — Vite dev server (<http://localhost:5173>)
- `npm run build` — `tsc -b` type-check + production build (keep gzip total ≤ 5 MB, SRS NF2)
- `npm test` — Vitest unit tests for pure helpers (`src/**/*.test.ts`); browser-level checks live in `tools/verify-*.mjs`
- **`src/sim/pkg.d.ts` is the ambient fallback** that keeps `tsc` green when `src/sim/pkg/` hasn't been generated. Add every new `Engine` method to it in the same change, or the no-Rust-toolchain path breaks while local builds stay green.
- `npm run preview` — serve the production build
- `npm run data:fetch` — regenerate `src/data/network.json` (every registered line's track geometry + stations) from OSM Overpass, driven by the registry in `tools/lines.config.mjs` (mirror fallback + User-Agent handled inside `tools/fetch-network.mjs`); pass one or more line keys as args to fetch a subset
- `node tools/inspect-gtfs.mjs <extracted-gtfs-dir>` — read-only: print every route in an extracted GTFS feed (id, agency, names, colour, trip count, frequency-based or not) — the fastest way to populate a new `tools/lines.config.mjs` entry or sanity-check the feed before wiring one up
- `node tools/screenshot.mjs [url] [outDir]` — headless-Edge screenshots from several camera poses (uses `puppeteer-core`, installed with `--no-save`; in dev builds the map instance is exposed as `window.__map` for this)
- `node tools/extract-stations.mjs <extracted-gtfs-dir>` — **legacy, MVP 1/2-era only.** Hardcoded to the old two-branch `src/data/green-line.json` schema (`doc.branches.sukhumvit`/`.silom`), which no longer exists — `fetch-network.mjs` now fetches station positions itself (from OSM stop nodes) for every registry line. Left in the tree for history; do not wire it into the MVP 5+ pipeline.

Rust toolchain (`stable-x86_64-pc-windows-gnu` — chosen because no MSVC build tools exist on this machine; plus `wasm32-unknown-unknown`, wasm-pack 0.13.1) lives at `%USERPROFILE%\.cargo\bin`, also **not on PATH**:

- `cargo test` (in `rust-engine/`) — 36 sim-core/preprocessor unit tests (26 + 10)
- `cargo run --manifest-path rust-engine/Cargo.toml -p preprocessor --release -- --gtfs <extracted-gtfs-dir> --track src/data/network.json --out public/data/network.tmb --report public/data/network.report.json` — regenerate the binary timetable cache for the whole registry (equivalently `npm run data:preprocess -- --gtfs <extracted-gtfs-dir>`); route identity comes entirely from `network.json`'s line order, not a hardcoded route-id list
- `wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg` — rebuild the Wasm engine (the built `src/sim/pkg/` and `public/data/network.tmb` are **committed**, so plain `npm run dev` works without a Rust toolchain; delete wasm-pack's generated `src/sim/pkg/.gitignore` if it reappears — it contains `*`)
- `node tools/verify-kinematics.mjs` / `node tools/verify-closeup.mjs` — data-level motion assertions / camera-on-a-train screenshot against the dev server (dev exposes `window.__map`, `window.__sim`, `window.__store` and `window.__localToLngLat` for these)
- `npm run verify:mvp4` — MVP 4 acceptance run: real canvas clicks select a train and a station, follow-camera lock, inspector/board contents, clock scrubbing (14 checks) — still Green-Line-shaped assertions, but they must keep passing unchanged as the network grows (single-line interaction is not allowed to regress)
- `npm run verify:mvp5` — MVP 5 acceptance run: every registry line renders in order, trains run on 3+ lines at once, hiding a line stops rendering but not simulation or clickability, an interchange station shows a transfer chip, a monorail's rendered geometry is shorter than a heavy-rail train's (6 checks)
- `npm run build && npm run preview` (one shell) then `npm run verify:perf` (another) — NF1 acceptance against a **production** build (`?debug=1` opts a prod bundle into exposing `window.__sim` for this check only): the sim ticks a meaningful sample count, sim tick p95 < 3 ms, no frame truncated, ≥55 FPS all pass (4/5); the ≥300-concurrent-vehicles check is a known, currently-failing gate — see "MVP 5's one disclosed gap" above

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
- **Click jitter can get misclassified as a drag.** MapLibre's default `clickTolerance` (3px) is how it tells a click from a drag-pan; ordinary pointer jitter between mousedown/mouseup can exceed that, firing `dragstart`. `MapContainer.tsx`'s `onDragStart` unconditionally drops `following` on any pan (so a real user drag hands control back — see `followCamera.ts`), so a misclassified click silently cancelled follow-camera on the very next click after engaging it. `MapContainer.tsx` sets `clickTolerance: 6` on the `MapLibreMap` constructor to absorb normal jitter; don't revert it as unused-looking noise. It's a mitigation, not a guarantee — a trackpad or touchscreen tap can still exceed 6px.

## Implementation notes (learned in MVP 2/3 — engine & pipeline)

- **`docs/ENGINE_CONTRACT.md` is the interface spec** for the cache format, stride-8 `Float32Array` vehicle buffer, worker protocol, and wasm API. Update it when any of those change — it's what keeps the Rust and TS sides in sync.
- **The Namtang feed is frequency-based for BTS**: routes 1/2 have 14 trip *patterns* with relative `stop_times` (starting 00:00:00) expanded via `frequencies.txt` headway windows (06:00–24:00). The preprocessor (`rust-engine/preprocessor`) expands them into ~2,162 concrete runs. Service 1 = weekdays, 2 = weekends, with 42 Thai-holiday `calendar_dates` exceptions.
- **MapLibre's earth radius is 6371008.8 m** (`src/geo/lng_lat.ts`), NOT the WGS84 circumference — `sim-core/src/geo.rs` replicates MapLibre's exact math so Rust ENU output matches `src/map/coordinates.ts` to sub-millimeter (unit-tested). Don't "fix" it to 40075016.686.
- **Engine positions are a pure function of time** (no integration): worker evaluates at 10 Hz into pooled transferable buffers (3-buffer ping-pong, never allocates on the frame path); `SimClient.getInterpolated` lerps the two latest frames matched by `run_idx`. Per-frame data never touches React/Zustand.
- **Schedule metadata is engine-side, not TS-side** (`sim-core/src/query.rs`, contract §7). The vehicle buffer carries pose only; headsign/ETA/origin/destination/station boards come from `run_detail`/`station_board` over a promise-based worker query channel. They are UI-rate (on selection, ~1 Hz) — putting one on the frame path re-introduces exactly the boundary cost §3A.2 exists to avoid. The TS mirrors in `protocol.ts` keep serde's snake_case verbatim; rename a field in Rust and the UI breaks silently unless both move together.
- **Trains are one draw call per route**: one merged vertex-colored geometry per route in `VehicleManager` (InstancedMesh, capacity `MAX_VEHICLES` = 1024 as of MVP 5 — was 512 through MVP 2–4, raised ahead of the 9-line network so a real peak is never silently truncated). That was "2 draw calls total" when the network was Green Line only (Sukhumvit + Silom); it is N draw calls for an N-line network now — still one per route, never one per train (SRS §3A.5).
- Bangkok time = UTC+7 fixed (no DST); the worker splits `simEpochMs + 7 h` into `date_yyyymmdd` + `sec_of_day` via UTC getters, and the engine also evaluates the *previous* service day at `sec+86400` for post-midnight spillover.
- Kheha (stop 13608) snaps 63.9 m from the OSM track end — genuine terminus geometry offset, under the 150 m hard limit; every other stop snaps < 40 m.

## Implementation notes (learned in MVP 5 — multi-line breadth)

- **The registry-index invariant is the load-bearing contract of the whole line-agnostic pipeline.** `tools/lines.config.mjs`'s `LINES` array order == `src/data/network.json` `lines[i]` order == the Rust cache's `CacheDoc.routes[i]` order == vehicle-buffer `route_idx` (lane 6) == `VehicleManager`'s per-route `InstancedMesh` index. It is enforced at three independent points: `assertRegistryValid()` (duplicate keys/route-ids, unknown structure/vehicleType, malformed color/id-list fields), a Rust preprocessor test (`route_order_follows_network_json_line_order`), and the fact that nothing anywhere hardcodes a route index or name — `fetch-network.mjs`, the preprocessor, and the frontend all just iterate whatever `LINES`/`network.json` contains. Appending a line is safe; reordering or removing one invalidates every committed `.tmb` and desyncs `route_idx` across the whole stack.
- **The track-only route path (`gtfsRouteId: null`) is a real, tested mechanism, not a stub.** A line entry with no GTFS route id renders (track + stations from its own `network.json` data) but never simulates (`RouteDoc.simulated = false`, no patterns, no runs, `station_board`/`run_detail` return an empty board rather than erroring — see `sim-core/src/query.rs` tests `a_track_only_route_has_an_empty_board_not_a_missing_one` / `..._still_reports_its_stations`). **No line in the current registry actually uses it** — all 9 entries in `LINES` have a real `gtfsRouteId` and are fully simulated; MRT Orange (the intended first user of this path) isn't in the registry at all yet, deferred whole to MVP 6. Don't read "9 lines rendered" as "9 lines simulated, plus track-only ones" — right now those are the same 9.
- **Interchange metadata is auto-linked within 300 m, plus a manual override list for what that radius can't reach.** The preprocessor's `link_interchanges()` (called with `INTERCHANGE_RADIUS_M = 300.0`) pairs any two different routes' stations within 300 m of each other, symmetric, never self-referential. `INTERCHANGE_OVERRIDES` in `tools/lines.config.mjs` (fed through as `TrackFile.interchange_overrides`, GTFS stop-id pairs) covers walkways/platforms the radius genuinely can't see — currently one entry: Purple↔Pink at Nonthaburi Civic Center, whose two platforms are ~555 m apart but share the same GTFS `stop_id` "359" on both sides (verified against OSM node tags, see the long comment on the `pink` registry entry), so the override pairs `["359", "359"]` — safe because no other route uses that stop id, so it can only ever resolve to Purple's copy and Pink's copy of it.
- **A registry line's `gtfsRouteId: Some(id)` doesn't guarantee frequency-based expansion.** The Namtang feed mixes both GTFS shapes: BTS-style routes (Sukhumvit, Silom) are frequency-based (relative `stop_times` + `frequencies.txt` headway windows); other operators (ARL, SRT Red, etc.) publish concrete absolute departures with no `frequencies.txt` rows for their trips at all. `runs_for_pattern()` in the preprocessor handles both: a trip with frequency rows expands into one run per headway slot, a trip with none becomes exactly one run starting at its own first stop's arrival time. A trip with neither shape is a hard error, never a silent zero-run drop.
- **`window.__map.getLayer("network-3d")` does not hand back the `NetworkLayer` instance directly.** MapLibre wraps every added layer in its own style-layer object; the `CustomLayerInterface` you passed to `addLayer()` — and its Three `scene` — lives on `.implementation`. Needed this to reach real rendered `InstancedMesh` geometry from a verify script (`tools/verify-mvp5.mjs`) rather than trusting the `ConsistSpec` config table alone.
- **`StationBoard.tsx`'s "Interchange" label and its transfer chips render inside a `uppercase`-styled heading** — `document.body.innerText` reflects the CSS text-transform, so a verify script comparing against the literal string `"Interchange"` (mixed case) silently never matches; compare case-insensitively, same gotcha `verify-mvp4.mjs` already documents for "next departures".

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
5. **MVP 5 — Multi-line breadth.** ✅ **Done.** Generalized to line-agnostic code; added Purple, ARL, Pink, Yellow, Gold, SRT Dark/Light Red (9 lines total, 155 stations, 4,481 runs). Line selector UI, cross-route interchange metadata, monorail/APM/commuter vehicle models. Performance validated with real numbers, not just "toward" a target — see "MVP 5's one disclosed gap" above: 3 of 4 NF1 sub-checks pass; peak concurrency (171–172 vehicles) is real GTFS density for these 9 lines, not yet the 300-vehicle target.
6. **MVP 6 — Underground + polish.** MRT Blue (underground), MRT Orange as **track geometry only** (pre-revenue — no trains/timetable until it enters service), underground transparency mode, day/night lighting, final bundle/perf hardening.

## Transit coverage & operator status

Nine lines are in scope (BTS Green [Sukhumvit + Silom], MRT Blue, MRT Purple, SRT Red, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, MRT Orange). Seven of the nine (everything except MRT Blue and MRT Orange) are in the registry and fully simulated as of MVP 5. **MRT Orange is pre-revenue and gets track geometry only** — no simulated trains, and it isn't even a registry entry yet (deferred whole to MVP 6) — until it has a published operational schedule. **MRT Blue remains unverified/unbuilt**, still scoped to MVP 6. The rest of the operational/pre-revenue classification was **re-verified against current sources on 2026-07-31** (SRS §2's caveat block, MVP 5 Task 11): MRT Orange is still pre-revenue (Eastern Section now projected late 2027, Western Section ~2030); the Pink Line's Muang Thong Thani spur has been in full revenue service since 2025-06-17 but is deliberately **not** in the registry (its trips share Pink's main `gtfs_route_id`, and its own OSM relation pair is a separate out-of-scope fetch); MRT Purple's southern extension (Tao Poon–Rat Burana) is still under construction, not open. Re-check again before public release if meaningfully more time has passed.

## Non-functional targets worth knowing before optimizing

- 60 FPS desktop / 30+ FPS mobile; Wasm sim tick < 3 ms/frame for up to 300 concurrent active vehicles. **As of MVP 5** (`npm run verify:perf` against the full 9-line network, production build): sim tick p95 ≈ 0.2–0.3 ms and ~100 FPS both comfortably clear the target, but the 300-concurrent-vehicle scale target is not yet reached — the real network's measured daily peak is 171–172 vehicles (`public/data/network.report.json`'s `peak_concurrent`), a real GTFS-density fact about these 9 lines, not a performance bug. `MAX_VEHICLES` is 1024 (~6× that peak), so there's headroom for MVP 6's remaining lines; the `verify:perf` assertion is left failing on purpose rather than weakened or gamed with synthetic load (4/5 sub-checks pass; only peak-concurrency fails).
- Initial bundle ≤ 5 MB compressed (including the binary timetable); GLTF models lazy-load with LOD. **As of MVP 5:** gzipped `dist/` + `network.tmb` totals ≈ 0.85 MB, well inside budget.
- Browser matrix: Chrome 90+, Safari 15+, Firefox 88+, Edge (Chromium) — WebGL 2.0 + WebAssembly baseline.
- OpenStreetMap-derived geometry requires ODbL attribution; any scraped fallback data must respect the source's ToS and is preprocessor-only, never live in the client.
