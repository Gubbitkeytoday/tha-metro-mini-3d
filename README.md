# Thailand Metro Mini 3D

> Interactive, web-based 3D visualization of Bangkok's rail transit network — trains moving on schedule along authentic geography, elevations, and timetables.

**Status:** 🚧 Early development — **MVP 1–3 delivered**: BTS Green Line 3D track, GTFS→binary data pipeline, and scheduled trains moving with time-warp; see the [roadmap](#roadmap). **Repo:** [`tha-metro-mini-3d`](https://github.com/naiiytom/tha-metro-mini-3d)

---

## What it is

Thailand Metro Mini 3D renders Bangkok's metro/rail lines as 3D track over a vector map and animates trains along them using published **static GTFS** timetables. Vehicle positions are computed by interpolating scheduled arrival/departure times — so you can watch the *scheduled* network at any moment, scrub through time, and follow individual trains.

> **Schedule-driven, not live.** v1.0 uses static timetables only, not real-time vehicle feeds (GTFS-Realtime). It shows where trains *should* be per schedule.

Full requirements live in [`tha-metro-mini-3d-SRS.md`](./tha-metro-mini-3d-SRS.md).

## Features

- 3D track geometry with real elevations — elevated (+12–22 m), at-grade, and underground (−12 to −25 m) segments.
- Schedule-based train motion with acceleration/deceleration easing and correct heading along the track.
- Time controls — real-time clock, 1×/5×/10×/60× speed, and scrub to any time.
- Camera modes — free orbit, third-person train-follow, and an underground transparency toggle.
- Line filters, a station/vehicle inspector, and a live timetable drawer.

## Coverage

Operational lines receive full simulation (track + trains); pre-revenue lines are rendered as track only.

| Line | Type | Operator | Structure | v1.0 |
|------|------|----------|-----------|------|
| BTS Sukhumvit & Silom (Green) | Heavy Rail | BTSC | Elevated | Full |
| MRT Blue | Heavy Rail | BEM | Underground / Elevated | Full |
| MRT Purple | Heavy Rail | BEM | Elevated | Full |
| SRT Red (North & West) | Commuter Rail | SRTET | At-Grade / Elevated | Full |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One | Elevated | Full |
| MRT Pink | Monorail | NBM | Elevated | Full |
| MRT Yellow | Monorail | EBM | Elevated | Full |
| BTS Gold | APM (monorail-class) | BMA/KT (BTSC) | Elevated | Full |
| MRT Orange | Heavy Rail | — | Underground / Elevated | **Track only (pre-revenue)** |

> ⚠️ Line status reflects **early 2025** and is unverified in this draft. Re-check the Orange Line and any new extensions (e.g. Pink Line spur to Muang Thong Thani, Purple southern extension) before relying on this table.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 18, Tailwind CSS, Lucide, Zustand |
| Build | Vite + TypeScript |
| Base map | MapLibre GL JS (vector tiles, 3D terrain) |
| 3D | Three.js via a custom MapLibre WebGL layer |
| Simulation core | Rust → WebAssembly (`wasm-pack`), run in a Web Worker |
| Data pipeline | Rust CLI: GTFS ZIP → compact binary cache (+ OpenStreetMap geometry) |

See [§3A of the SRS](./SRS.md) for design rationale and key risks (cross-origin isolation, the MapLibre↔Three bridge, float precision at city scale, serialization).

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

> Prerequisites: [Node.js](https://nodejs.org/) 18+. The built Wasm engine (`src/sim/pkg/`) and binary timetable (`public/data/green-line.tmb`) are committed, so a Rust toolchain is **only** needed to regenerate them ([Rust](https://rustup.rs/) + `wasm32-unknown-unknown` target + [`wasm-pack`](https://rustwasm.github.io/wasm-pack/); see `rust-engine/`).

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
| `npm run preview` | Serve the production build locally |
| `npm run data:fetch` | Regenerate `src/data/green-line.json` track geometry from OpenStreetMap (Overpass) |
| `node tools/extract-stations.mjs <gtfs-dir>` | Merge official station coordinates from an extracted [Namtang GTFS](https://namtang-api.otp.go.th/opendata) feed |
| `node tools/screenshot.mjs [url] [outDir]` | Headless-browser screenshots from several camera poses (visual check) |

## Roadmap

Delivered as vertical, shippable slices — track geometry first, then motion, then breadth.

| MVP | Deliverable |
|-----|-------------|
| **1** ✅ | **BTS Green Line track laid** — 3D geometry over the map, no trains. Proves the full render pipeline. **Delivered:** MapLibre (OpenFreeMap vector tiles) + Three.js custom layer with floating-origin coordinates; spline-smoothed elevated track for both branches; station markers; free orbit camera. |
| **2** ✅ | Green Line data pipeline — GTFS → binary cache, loaded & validated client-side. **Delivered:** Rust preprocessor expands the frequency-based Namtang feed (14 patterns → 2,162 runs, 61 stations snapped onto track) into a 123 KB bincode cache (71 KB gzip vs 3 MB budget); client validation summary shown in the UI. |
| **3** ✅ | Green Line trains moving — Wasm interpolation engine + Web Worker. **Delivered:** 93 KB Wasm engine (dwell/transit/smoothstep/tangent-yaw) evaluated at 10 Hz in a worker, transferable-buffer ping-pong, render-side interpolation, InstancedMesh 4-car trains (2 draw calls), 1×/5×/10×/60× time-warp with Bangkok clock. |
| 4 | Interaction & UI — follow-cam, inspector, time scrubber, timetable drawer. |
| 5 | Multi-line breadth — Purple, ARL, Pink, Yellow, Gold, Red. |
| 6 | Underground + polish — MRT Blue, Orange (track only), transparency mode, day/night lighting. |

## Data & licensing

- Transit schedules & station coordinates: static **GTFS** ([Namtang / OTP open-data programme](https://namtang-api.otp.go.th/opendata), CC-BY 4.0).
- Track geometry: **OpenStreetMap** — © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/); attribution required (rendered in the map attribution control).
- Base map: [OpenFreeMap](https://openfreemap.org/) vector tiles (Liberty style).
- Any scraped source is a fallback only, used in the offline preprocessor, subject to the source's terms.

## License

_TBD._ <!-- Choose and add a LICENSE file (e.g. MIT) before public release. -->

---

*This is a fan/hobby visualization project and is not affiliated with any transit operator.*
