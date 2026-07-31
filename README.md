# Greater Bangkok Metro Mini 3D

> Interactive, web-based 3D visualization of Bangkok's rail transit network — trains moving on schedule along authentic geography, elevations, and timetables.

**Status:** 🚧 Early development — **MVP 1–5 delivered**: BTS Green Line 3D track, GTFS→binary data pipeline, scheduled trains moving with time-warp, click-to-inspect with a follow camera and time scrubber, and multi-line breadth (MRT Purple, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, SRT Dark/Light Red — 9 lines simulated, 155 stations, 4,481 runs); see the [roadmap](#roadmap). **Repo:** [`tha-metro-mini-3d`](https://github.com/naiiytom/tha-metro-mini-3d)

---

## What it is

Greater Bangkok Metro Mini 3D renders the Bangkok Metropolitan Region's metro/rail lines as 3D track over a vector map and animates trains along them using published **static GTFS** timetables. Vehicle positions are computed by interpolating scheduled arrival/departure times — so you can watch the *scheduled* network at any moment, scrub through time, and follow individual trains.

> **Schedule-driven, not live.** v1.0 uses static timetables only, not real-time vehicle feeds (GTFS-Realtime). It shows where trains *should* be per schedule.

Full requirements live in [`docs/SRS.md`](./docs/SRS.md).

## Features

- 3D track geometry with real elevations — elevated (+12–22 m), at-grade, and underground (−12 to −25 m) segments.
- Schedule-based train motion with acceleration/deceleration easing and correct heading along the track.
- Time controls — real-time clock, 1×/5×/10×/60× speed, and scrub to any time.
- Camera modes — free orbit, third-person train-follow, and an underground transparency toggle.
- Line filters, a station/vehicle inspector, and a live timetable drawer.

### Camera controls

| Gesture | Effect |
|---------|--------|
| Left-drag | Pan |
| Scroll wheel | Zoom |
| Press the wheel + drag, right-drag, or ctrl + left-drag | Orbit — drag up to tilt toward the horizon, down to flatten toward top-down, sideways to swing the compass bearing |

Orbiting moves both axes in one motion, so a diagonal drag tilts and turns together.

## Coverage

Operational lines receive full simulation (track + trains); pre-revenue lines are rendered as track only. **As of MVP 5 (2026-07-31), nine lines are simulated**: BTS Sukhumvit & Silom, MRT Purple, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, and SRT Dark/Light Red — 155 stations, 34 trip patterns, 4,481 expanded runs, ~213 KB gzip. MRT Blue and Orange remain MVP 6.

| Line | Type | Operator | Structure | v1.0 |
|------|------|----------|-----------|------|
| BTS Sukhumvit & Silom (Green) | Heavy Rail | BTSC | Elevated | Full |
| MRT Purple | Heavy Rail | BEM | Elevated | Full |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One | Elevated | Full |
| MRT Pink | Monorail | NBM | Elevated | Full |
| MRT Yellow | Monorail | EBM | Elevated | Full |
| BTS Gold | APM (monorail-class) | BMA/KT (BTSC) | Elevated | Full |
| SRT Dark Red | Commuter Rail | SRTET | Elevated | Full |
| SRT Light Red | Commuter Rail | SRTET | Elevated | Full |
| MRT Blue | Heavy Rail | BEM | Underground / Elevated | MVP 6 (not yet added) |
| MRT Orange | Heavy Rail | — | Underground / Elevated | **Track only (pre-revenue)** |

> Line status re-verified 2026-07-31 (see [`docs/SRS.md` §2](./docs/SRS.md#2-system-scope--transit-coverage)): MRT Orange is still pre-revenue (Eastern Section now projected late 2027, Western Section 2030) and stays MVP 6 track-only. The Pink Line's Muang Thong Thani spur has been in full paid revenue service since 2025-06-17 but is **not yet in this registry** — the Namtang feed bundles its 4 shuttle trip patterns into the same GTFS route id as the main Pink Line, and its own OSM relation pair wasn't fetched for this task, so it's excluded from simulation for now (main Pink Line is unaffected). The Purple Line's Tao Poon–Rat Burana southern extension remains under construction, not open.

### Track geometry provenance (OSM relations)

Every line's 3D track polyline comes from a **pinned** OpenStreetMap route relation (never a live discovery lookup at build time — a name-match discovery mode exists in `tools/fetch-network.mjs` only for bootstrapping a *new* line, and its resolved id must be pinned back into the registry before it's committed). Station coordinates for simulated lines come from the Namtang GTFS feed; track-only lines (currently none — see [Coverage](#coverage)) would use OSM stop nodes instead.

| Line | OSM relation id | GTFS `route_id` |
|------|-----------------|------------------|
| BTS Sukhumvit | [444651](https://www.openstreetmap.org/relation/444651) | `1` |
| BTS Silom | [2067854](https://www.openstreetmap.org/relation/2067854) | `2` |
| MRT Purple | [6988563](https://www.openstreetmap.org/relation/6988563) | `4` |
| Airport Rail Link | [2148241](https://www.openstreetmap.org/relation/2148241) | `5` |
| MRT Pink | [16740886](https://www.openstreetmap.org/relation/16740886) | `2436` |
| MRT Yellow | [15806897](https://www.openstreetmap.org/relation/15806897) | `2224` |
| BTS Gold | [11681439](https://www.openstreetmap.org/relation/11681439) | `2025` |
| SRT Dark Red | [13058384](https://www.openstreetmap.org/relation/13058384) | `2026` |
| SRT Light Red | [13178788](https://www.openstreetmap.org/relation/13178788) | `2027` |

Source of truth for this table: `tools/lines.config.mjs`'s `LINES` registry — update there first, this table is descriptive.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, Tailwind CSS, Lucide, Zustand |
| Build | Vite + TypeScript |
| Base map | MapLibre GL JS (vector tiles, 3D terrain) |
| 3D | Three.js via a custom MapLibre WebGL layer |
| Simulation core | Rust → WebAssembly (`wasm-pack`), run in a Web Worker |
| Data pipeline | Rust CLI: GTFS ZIP → compact binary cache (+ OpenStreetMap geometry) |

See [§3A of the SRS](./docs/SRS.md) for design rationale and key risks (cross-origin isolation, the MapLibre↔Three bridge, float precision at city scale, serialization).

## Project structure

```
tha-metro-mini-3d/
├── rust-engine/          # Rust Wasm simulation core (parser, interpolation, spatial)
├── src/                  # Vite + React frontend
│   ├── components/       # UI overlay, controls, inspector, time scrubber
│   ├── map/              # MapLibre ↔ Three.js bridge, vehicle & camera managers
│   ├── stores/           # Zustand state
│   └── types/
├── tools/                # data-fetch, verification & screenshot scripts
├── index.html
└── vite.config.ts
```

## Getting started

> Prerequisites: [Node.js](https://nodejs.org/) 18+. The built Wasm engine (`src/sim/pkg/`) and binary timetable (`public/data/network.tmb`) are committed, so a Rust toolchain is **only** needed to regenerate them ([Rust](https://rustup.rs/) + `wasm32-unknown-unknown` target + [`wasm-pack`](https://rustwasm.github.io/wasm-pack/); see `rust-engine/`).

```bash
# clone
git clone https://github.com/naiiytom/tha-metro-mini-3d.git
cd tha-metro-mini-3d

# install deps and run the dev server
npm install
npm run dev
```

Other scripts:

| Command | What it does |
|---------|--------------|
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Vitest unit tests for the pure helpers (time formatting, bearing math) |
| `npm run preview` | Serve the production build locally |
| `npm run data:fetch [lineKey ...]` | Regenerate `src/data/network.json` — every registry line's track geometry + stations from OpenStreetMap (Overpass); pass one or more `tools/lines.config.mjs` keys to fetch a subset |
| `node tools/inspect-gtfs.mjs <gtfs-dir>` | Read-only: print every route in an extracted GTFS feed (id, agency, names, colour, trip count, frequency-based or not) — the fastest way to check a feed before adding a `tools/lines.config.mjs` entry |
| `npm run screenshot -- [url] [outDir]` | Headless-browser screenshots from several camera poses (visual check) |
| `npm run verify:camera` | Camera gesture assertions (pan/zoom/pitch/bearing) against a running dev server |
| `npm run verify:mvp4` | MVP 4 acceptance: selection, follow-camera, inspector, station board, scrubbing |
| `npm run verify:mvp5` | MVP 5 acceptance: every registry line renders in order, trains run on 3+ lines at once, hiding a line preserves its simulation and blocks its clicks, interchange chips render, monorail vs. heavy-rail rendered geometry differs |
| `npm run verify:kinematics` | Data-level motion assertions against a running dev server |
| `npm run verify:closeup` | Camera-on-a-train screenshot against a running dev server |
| `npm run build && npm run preview` (one shell), then `npm run verify:perf` (another) | NF1 performance acceptance against a **production** build: sim tick time, truncation, frame rate, and peak-concurrency scale — see [Coverage](#coverage) for the current, honestly-disclosed 3/4 result |

Rust toolchain required for these (see [CONTRIBUTING](./docs/CONTRIBUTING.md)):

| Command | What it does |
|---------|--------------|
| `npm run rust:test` | `cargo test` across the `rust-engine/` workspace (36 tests) |
| `npm run wasm:build` | Rebuild the Wasm engine into `src/sim/pkg/` (committed output) |
| `npm run data:preprocess -- --gtfs <gtfs-dir>` | Regenerate `public/data/network.tmb` for the whole registry from an extracted GTFS feed (committed output) — route identity comes entirely from `network.json`'s line order |

## Roadmap

Delivered as vertical, shippable slices — track geometry first, then motion, then breadth.

| MVP | Deliverable |
|-----|-------------|
| **1** ✅ | **BTS Green Line track laid** — 3D geometry over the map, no trains. Proves the full render pipeline. **Delivered:** MapLibre (OpenFreeMap vector tiles) + Three.js custom layer with floating-origin coordinates; spline-smoothed elevated track for both branches; station markers; free orbit camera. |
| **2** ✅ | Green Line data pipeline — GTFS → binary cache, loaded & validated client-side. **Delivered:** Rust preprocessor expands the frequency-based Namtang feed (14 patterns → 2,162 runs, 61 stations snapped onto track) into a 123 KB bincode cache (71 KB gzip vs 3 MB budget); client validation summary shown in the UI. |
| **3** ✅ | Green Line trains moving — Wasm interpolation engine + Web Worker. **Delivered:** 93 KB Wasm engine (dwell/transit/smoothstep/tangent-yaw) evaluated at 10 Hz in a worker, transferable-buffer ping-pong, render-side interpolation, InstancedMesh 4-car trains (2 draw calls), 1×/5×/10×/60× time-warp with Bangkok clock. |
| **4** ✅ | Interaction & UI — follow-cam, inspector, time scrubber, timetable drawer. **Delivered:** click-to-select trains and stations (screen-space picking), third-person follow camera, train inspector with next-stop ETA and the full call list, live station board, and a scrubber over the service day; schedule lookups added to the Rust engine and crossed over a promise-based worker query channel. |
| **5** ✅ | Multi-line breadth — Purple, ARL, Pink, Yellow, Gold, Red. **Delivered:** the line registry (`tools/lines.config.mjs`) grew from 2 to 9 entries with pinned OSM relation ids and GTFS route ids verified against the real Namtang feed; 155 stations, 34 patterns, 4,481 runs, ~213 KB gzip cache. Surfaced and fixed real data-pipeline gaps along the way: an OSM-node-id type mismatch, the Pink Line's Muang Thong Thani spur trips sharing a GTFS route id with the main line, a GTFS/OSM coordinate mismatch at the Pink Line's own terminus, and OSM stop-position nodes without name tags silently blanking station names. Line selector, cross-route interchange metadata, and monorail/APM vehicle models shipped alongside; `npm run verify:mvp5` (6/6) and `npm run verify:mvp4` (14/14, unchanged) both green. **NF1 performance is 3 of 4 sub-checks, disclosed not hidden:** sim tick (p95 ≈ 0.2–0.3 ms), no truncation, and frame rate (~100 FPS) all pass; the ≥300-concurrent-vehicle scale target is not yet reached — this real 9-line network's measured peak is 171–172 vehicles, well under `MAX_VEHICLES` (1024) but under the 300 target too. That's real GTFS schedule density for these lines, not a bug, and the assertion is left failing on purpose rather than weakened. |
| 6 | Underground + polish — MRT Blue, Orange (track only), transparency mode, day/night lighting. |

## Data & licensing

- Transit schedules & station coordinates: static **GTFS** ([Namtang / OTP open-data programme](https://namtang-api.otp.go.th/opendata), CC-BY 4.0).
- Track geometry: **OpenStreetMap** — © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/); attribution required (rendered in the map attribution control).
- Base map: [OpenFreeMap](https://openfreemap.org/) vector tiles (Liberty style).
- Any scraped source is a fallback only, used in the offline preprocessor, subject to the source's terms.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./docs/CONTRIBUTING.md) — it covers setup, how work is scoped into MVP slices, and the architectural conventions that get checked in review. By participating you agree to the [Code of Conduct](./docs/CODE_OF_CONDUCT.md).

## License

Source code is licensed under the [MIT License](./LICENSE).

Bundled data keeps its own terms: OpenStreetMap-derived track geometry is ODbL, and the Namtang GTFS-derived timetables and station coordinates are CC-BY 4.0. Both attributions render in the map's attribution control and must be kept in any redistribution.

---

*This is a fan/hobby visualization project and is not affiliated with any transit operator.*
