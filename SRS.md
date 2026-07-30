# Software Requirements Specification (SRS)

**Project Name:** Thailand Metro Mini 3D — 3D Transit Simulation Platform
**Version:** 1.0.0
**Status:** Draft / Technical Proposal
**Last Updated:** 2026-07-30
**Repository:** [tha-metro-mini-3d](https://github.com/naiiytom/tha-metro-mini-3d)

---

## 1. Executive Summary & Vision

Thailand Metro Mini 3D is an interactive, web-based 3D visualization and simulation platform that models the scheduled movement of Bangkok's rail transit network. Inspired by [Mini Tokyo 3D](https://minitokyo3d.com/), the application renders 3D train models operating along authentic geographic coordinates, station elevations, and published schedule constraints.

The platform uses the open **Static GTFS** data standard published for Thailand's transit networks (via the Namtang / OTP open-data programme) and computes vehicle kinematics in a high-performance simulation core compiled from **Rust to WebAssembly**. Rendering is handled by a modern web 3D stack: **Vite**, **TypeScript**, **MapLibre GL JS**, and **Three.js**.

> **Scope note — simulated vs. real-time.** Version 1.0 is driven exclusively by *static* GTFS timetables. Trains are placed by interpolating scheduled arrival/departure times, not by live vehicle positions (GTFS-Realtime). The product therefore visualizes the *scheduled* network state at any chosen moment, including past and future times via time-scrubbing. Live real-time tracking is explicitly out of scope for this version (see §8).

---

## 2. System Scope & Transit Coverage

The simulation covers the major urban rail networks in the Bangkok Metropolitan Region:

| Line | Transit Type | Operator | Structure |
|------|-------------|----------|-----------|
| BTS Sukhumvit & Silom Lines | Heavy Rail | BTSC | Elevated |
| MRT Blue Line | Heavy Rail | BEM | Underground / Elevated |
| MRT Purple Line | Heavy Rail | BEM | Elevated |
| SRT Red Lines (North & West) | Commuter Rail | SRTET (SRT) | At-Grade / Elevated |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One (SRT) | Elevated |
| MRT Pink Line | Monorail | NBM | Elevated |
| MRT Yellow Line | Monorail | EBM | Elevated |
| BTS Gold Line | Automated People Mover (Monorail-class) | BMA / KT (operated by BTSC) | Elevated |
| MRT Orange Line *(track only — pre-revenue)* | Heavy Rail | — | Underground / Elevated |

**Coverage assumptions**

- All lines above are in scope for v1.0. The **Gold Line** is operational and receives full simulation (track + moving trains). The **Orange Line** is not yet in passenger service, so it is included as **rendered track geometry only** — no vehicles, no timetable — until an operational schedule exists (see §7 MVP 6 and §8).
- Interchange relationships between lines are modelled for the UI inspector but do not affect vehicle motion (no passenger routing in v1.0).

> **⚠ Operational-status caveat — verify before publishing.** The operational vs. pre-revenue classification above reflects the situation as of **early 2025** and has **not** been confirmed against a live source in this draft. Bangkok's rail network is expanding rapidly; before release, re-verify each line's current status and reconcile the roadmap accordingly:
> - **MRT Orange Line** — highest priority to check. If it has since entered revenue service, promote it from "track only" (MVP 6) to full simulation (add GTFS feed + trains, per the MVP 5/6 path).
> - **Extensions** — check for newly-opened segments, e.g. the **Pink Line spur to Muang Thong Thani**, and the **MRT Purple Line southern extension (Tao Poon–Rat Burana)**, which was under construction as of early 2025. Add any opened segment to this table.
> - Lines listed as operational (Green, Blue, Purple, Red, ARL, Pink, Yellow, Gold) were all in passenger service as of early 2025 and are not expected to have regressed, but station-count/extension changes should still be checked when sourcing each GTFS feed.

---

## 3. Recommended Tech Stack

To achieve high rendering performance (target 60 FPS) and fast data parsing without blocking the main UI thread, the following modern stack is specified.

```
+-----------------------------------------------------------------------+
|                             USER INTERFACE                            |
|             React 18 / Tailwind CSS / Lucide React / Vite             |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                         VISUALIZATION LAYER                           |
|      MapLibre GL JS (Base Map)  <--->  Three.js / WebGL Layer         |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                         SIMULATION CORE ENGINE                        |
|  Rust (Wasm Engine via `wasm-pack`) + Web Worker Thread               |
|  - GTFS Parsing & Binary Serialization (Bincode / MessagePack)        |
|  - Timetable Interpolation & Spline Curve Calculation                 |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                            DATA PIPELINE                              |
|  OTP / Namtang GTFS Feed + OpenStreetMap (Geometry) + Scraper         |
+-----------------------------------------------------------------------+
```

**Build tooling & dev server:** Vite + TypeScript.

**UI layer:** React 18. *(The framework is fixed to React for v1.0 to match the component structure in §6. Svelte was considered but is deferred to keep a single, consistent component model; see §8.)*

**Core processing engine (Rust → Wasm):**

- Rust compiled to WebAssembly via `wasm-pack` for fast binary parsing of GTFS datasets, timetable lookup, spatial interpolation, and spline vector generation.
- Web Workers execute the Wasm simulation loop off the main UI/render thread.

**Map & spatial rendering:**

- **MapLibre GL JS** — vector-tile base map, 3D terrain and building extrusion support.
- **Three.js** (via a custom MapLibre WebGL layer) — 3D vehicle models (`.glb` / `.gltf`), lighting, shadows, and camera matrices.
- **Spatial utilities** — Turf.js on the JS side, or Rust spatial crates (`geo`, `spade`) inside Wasm.

---

## 3A. Technical Design Deep-Dive & Stack Validation

This section validates each stack choice against the project's actual constraints, documents the non-obvious risks, and records where a different tool would be the better call. It exists because several of these decisions are load-bearing and expensive to reverse once code is written.

### 3A.1 Overall verdict

The stack is well-matched to the problem and closely mirrors the proven Mini Tokyo 3D architecture. **No layer needs to be replaced**, but four decisions carry real risk and are called out below: the cross-origin isolation requirement for shared-memory threading (3A.3), the MapLibre↔Three coordinate/depth bridge (3A.4), floating-point precision at city scale (3A.5), and the serialization-format choice (3A.6). Each has a concrete recommendation.

### 3A.2 Rust → WebAssembly core

**Why it fits.** GTFS parsing, spline generation, and per-frame interpolation for hundreds of vehicles are CPU-bound numeric work — exactly where Wasm's near-native throughput and predictable (GC-free) timing beat JavaScript. Rust's `wasm-bindgen` / `wasm-pack` toolchain is the mature default.

**Gotchas & recommendations.**

- **The JS↔Wasm boundary is the bottleneck, not the math.** Marshalling data across the boundary every frame (especially anything that touches JS objects or strings) will dominate your 3-ms budget. *Recommendation:* the engine should write vehicle transforms into a single flat, pre-allocated `Float32Array` (a linear-memory view), and JS reads that buffer directly with zero per-vehicle calls. Design the API around "tick(time) → fills shared buffer," not "getVehicle(id)."
- **Wasm bundle weight.** Pull in `wee_alloc` or the default allocator carefully, enable `opt-level = "z"`/`"s"` and `lto`, and run `wasm-opt` (via `wasm-pack`'s release profile). A careless build can add 300–500 KB against your 5 MB budget.
- **`geo`/`spade` are fine**; you likely only need `geo` for Catmull-Rom/Bézier resampling. `spade` (Delaunay) is probably overkill for v1.0 — defer it.

### 3A.3 Web Worker concurrency — the cross-origin isolation trap

**This is the highest-risk item in the spec.** The plan to run the Wasm simulation loop in a Worker and share results with the main thread implies `SharedArrayBuffer`. Since Spectre, `SharedArrayBuffer` is **only available in cross-origin-isolated contexts**, which requires serving the app with both headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   (or credentialless)
```

**Consequences you must plan for now, not later:**

- Every cross-origin sub-resource (map tiles, fonts, CDN scripts, GLTF assets) must send `Cross-Origin-Resource-Policy` / proper CORS, or it will be **blocked** under `require-corp`. Your MapLibre tile source in particular must be COEP-compatible.
- Static hosts differ in header support — GitHub Pages can't set these; Netlify/Cloudflare Pages/Vercel can. **Confirm the deployment target supports custom headers before the Worker is introduced in MVP 3** (only required if the `SharedArrayBuffer` path is chosen).

**Two mitigation paths:**

1. **Avoid `SharedArrayBuffer` entirely (recommended for v1.0).** Use standard `postMessage` with **transferable** `ArrayBuffer`s. The Worker owns the buffer, computes a tick, and transfers it to the main thread each frame (or on a fixed sim cadence, decoupled from render). Transfer is zero-copy and sidesteps the entire COOP/COEP problem. This is simpler and almost certainly fast enough at 300 vehicles.
2. **Use `SharedArrayBuffer`** only if profiling proves transfer overhead matters — and only after confirming the header/hosting story.

*Recommendation:* Spec v1.0 around transferable buffers; treat `SharedArrayBuffer` as an optimization behind a feature flag.

### 3A.4 MapLibre GL JS ↔ Three.js bridge

**Why it fits.** This is the canonical way to draw true-3D content (models, shadows, arbitrary meshes) over a vector base map, and it's exactly what Mini Tokyo 3D does. MapLibre's `CustomLayerInterface` hands you the WebGL context and a per-frame projection matrix.

**Gotchas & recommendations.**

- **Coordinate conversion.** Three.js world units are *not* lng/lat. You must project every position through `MercatorCoordinate.fromLngLat()` and apply the resulting scale, and feed MapLibre's supplied matrix into your Three camera each frame. Getting the mercator *meters-per-unit* scale right (it varies with latitude) is the classic source of "my trains are the size of buildings" bugs.
- **Depth & occlusion.** Sharing the depth buffer between MapLibre's tiles/buildings and the Three layer is fiddly — this is precisely what makes the **underground transparency mode (F3.2)** non-trivial. Underground track at −25 m must be occluded by terrain unless transparency is toggled. Budget explicit time for depth-test/params tuning; don't assume it's free.
- **Context sharing.** Both must render into the **same** WebGL context. Do not let Three create its own canvas/context.

**Alternative worth a look:** **deck.gl** with `MapboxOverlay` (interleaved mode) works with MapLibre and manages the projection/depth interop for you, and it excels at large numbers of instanced objects. Trade-off: less low-level control over custom shaders/camera than raw Three.js, and Mini Tokyo 3D deliberately uses Three for that control. *Recommendation:* stay with Three.js for the model fidelity and follow-camera requirements, but if the bridge math becomes a time sink, deck.gl is a credible fallback.

### 3A.5 Rendering scale: instancing and float precision

- **Draw calls.** 300 trains as 300 separate meshes = 300 draw calls plus overhead. *Recommendation:* use Three.js `InstancedMesh` per vehicle type, updating a single instance-matrix buffer from the Wasm output array. This collapses hundreds of draws into a handful and is the key to hitting 60 FPS on a GTX 1050.
- **Float32 precision at city scale.** WebGL is `float32`. Absolute mercator/world coordinates for Bangkok are large enough that `float32` precision causes visible vertex jitter, especially in follow-camera. *Recommendation:* adopt a **floating-origin / camera-relative** scheme — keep geometry in coordinates relative to a local origin near the current view, not absolute world space. This is a well-known WebGL-mapping pattern; design it in from MVP 1 (the initial map↔Three bridge) rather than retrofitting.
- **Shadows (F3.1/F3.3).** Real-time shadow maps for a day/night cycle across the whole city are expensive. *Recommendation:* single directional light with a tightly-fit shadow frustum (or shadows only near the camera), and make shadows a quality toggle for the 30-FPS mobile target.

### 3A.6 Serialization format for the binary cache

The spec lists "Bincode or MessagePack" (and mentions Protobuf elsewhere). These are **not** equivalent for this use case:

- **MessagePack** — cross-language, self-describing, good if any non-Rust tool must read the cache. Requires full deserialization into structs before use.
- **Bincode** — compact and fast, Rust-to-Rust only; also requires deserialization into owned structs (allocations at load time).
- **`rkyv` (recommended to evaluate)** — zero-copy deserialization: you memory-map/typecast the bytes and read structs *in place* with no parse step. For a "load a big timetable blob once, then random-access it" pattern, this meaningfully improves cold-start and memory. Trade-off: stricter schema handling and a slightly steeper learning curve.

*Recommendation:* if the cache is only ever produced and consumed by your own Rust code (it is), evaluate **`rkyv`** first; fall back to **Bincode** for simplicity. Reserve MessagePack/Protobuf for any interchange boundary that must be language-neutral. Whichever you pick, `gzip`/`brotli` on the wire still applies to the <3 MB target.

### 3A.7 Simulation-loop architecture

- **Decouple sim tick from render frame.** Run the Wasm simulation at a fixed cadence (e.g., a stable timestep) and **interpolate transforms on the render side** between the two latest sim states. This keeps motion smooth even if a sim tick occasionally runs long, and makes the time-warp multipliers (F2.3) a clean scalar on sim time rather than a render-rate hack.
- **State ownership.** The Worker/Wasm owns simulation truth; the main thread owns render/camera/UI. Zustand (already chosen) holds only UI-facing derived state (selected train, active line filters), not per-frame kinematics — those never enter React state or you'll thrash re-renders.

### 3A.8 Data pipeline reality check

- **Scraping (Apify) is a legal/stability risk, not a technical one.** Treat any scraped schedule as a fallback where no GTFS exists, cache it aggressively, and record provenance (see NF4). Do not put a live scrape in the client runtime — it belongs in the offline preprocessing CLI only.
- **GTFS `shapes.txt` quality varies.** Bangkok feeds may have coarse or missing shapes; the OSM-geometry fallback and spline resampling (F1.3) are therefore not optional polish — they're core pipeline steps. Budget for shape/stop-snapping (aligning stop coordinates onto the track line).

### 3A.9 Summary of recommendations

| Area | Spec as written | Recommendation | Priority |
|------|-----------------|----------------|----------|
| Worker sharing | Web Worker (implies SharedArrayBuffer) | Transferable `ArrayBuffer` via `postMessage`; avoid COOP/COEP for v1.0 | **High** |
| JS↔Wasm API | per-vehicle access implied | Single flat `Float32Array` transform buffer | **High** |
| Rendering | GLTF per vehicle | `InstancedMesh` per vehicle type | **High** |
| Precision | absolute world coords | Floating-origin / camera-relative coords | **High** |
| MapLibre↔Three | custom WebGL layer | Keep Three; know `MercatorCoordinate` + depth-buffer work; deck.gl as fallback | Medium |
| Serialization | Bincode / MessagePack / Protobuf | Evaluate `rkyv` first; else Bincode | Medium |
| Sim loop | 60 FPS tick | Fixed-timestep sim + render-side interpolation | Medium |
| Shadows | dynamic day/night shadows | Tight shadow frustum; quality toggle on mobile | Low |

---

## 4. Architectural & Functional Requirements

### F1. Data Pipeline & Preprocessing Engine

- **F1.1 — GTFS ingestion.** The engine must ingest static GTFS datasets. Required files: `trips.txt`, `stop_times.txt`, `shapes.txt`, `routes.txt`, `stops.txt`, `calendar.txt`, and `calendar_dates.txt`. `agency.txt` is parsed for operator attribution. *(Calendar files are required to resolve which services run on a given date and were added here because scheduling is impossible without them.)*
- **F1.2 — Pre-compiled binary cache.** A Rust CLI preprocessor converts raw GTFS ZIP feeds into a compact binary format (Bincode or MessagePack) to minimize client payload. **Target: < 3 MB compressed** for the timetable/geometry bundle.
- **F1.3 — Route geometry & elevation (Z-axis).**
  - GeoJSON shapes carry 3D coordinates: `[longitude, latitude, altitude_meters]`.
  - Altitude offsets by structure type:
    - Underground (MRT Blue tunnelled sections): **−12.0 m to −25.0 m**
    - At-grade (SRT ground sections): **+0.5 m**
    - Elevated (BTS / monorails / ARL): **+12.0 m to +22.0 m**
  - Spline smoothing (Catmull-Rom or cubic Bézier) is applied to track paths to prevent abrupt heading changes at curve nodes.

### F2. Timetable & Motion Interpolation Engine

- **F2.1 — Interpolation algorithm.** Given system time *t*, the vehicle's active state is:

$$
\text{Status}(t) =
\begin{cases}
\text{Dwell at Station } A, & t_{\text{arr},A} \le t \le t_{\text{dep},A} \\
\text{In transit } A \rightarrow B, & t_{\text{dep},A} < t < t_{\text{arr},B} \\
\text{Inactive}, & \text{otherwise}
\end{cases}
$$

  The in-transit position uses a normalized progress value *p* with a smooth ease-in/ease-out (S-curve / smoothstep) profile to mimic acceleration and deceleration:

$$
p = \frac{t - t_{\text{dep},A}}{t_{\text{arr},B} - t_{\text{dep},A}}, \qquad
\text{Progress}(p) = 3p^2 - 2p^3
$$

- **F2.2 — Heading & orientation.** Compute continuous yaw angles from the track's 3D tangent vector so models face the exact direction of travel.
- **F2.3 — Time-warp controls.** Support real-time clock synchronization, speed multipliers (**1×, 5×, 10×, 60×**), and a custom time-picker for scrubbing to any moment.

### F3. 3D Scene Rendering & Camera Control

- **F3.1 — Train models.** Lightweight GLTF/GLB models per vehicle type (4-car heavy rail; 3/4-car monorail), coloured to each line's identity.
- **F3.2 — View modes.**
  - *Overview / free camera* — smooth orbit controls over the Bangkok area.
  - *Vehicle follow (third-person)* — camera transform smoothly locks to a selected train ID.
  - *Underground transparency* — reduce terrain/building opacity (**0.1 to 0.4**) when viewing underground segments (MRT Blue).
- **F3.3 — Environmental effects.** Dynamic day/night lighting driven by the simulated clock (sun-position calculation).

### F4. User Interface & Information Overlay

- **F4.1 — Live line selector.** Toggle visibility of individual lines (e.g., BTS Sukhumvit, MRT Blue, monorails).
- **F4.2 — Station & vehicle inspector card.** Clicking a train or station shows route name, next-station ETA, interchange options, and origin/destination.
- **F4.3 — Live timetable drawer.** Bottom panel listing currently active trains and upcoming departures for the selected station.

---

## 5. Non-Functional Requirements

**NF1 — Performance & frame rate.**
Target 60 FPS on desktop (GTX 1050 / Apple M1 or equivalent) and 30+ FPS on mobile WebGL browsers. The Wasm simulation tick must complete in **< 3 ms per frame** for up to **300 concurrent active vehicles**.

**NF2 — Initial load & optimization.**
Total initial bundle **≤ 5 MB** (compressed assets + binary timetable). 3D GLTF models lazy-load asynchronously with Level-of-Detail (LOD) progressive detail.

**NF3 — Cross-platform compatibility.**
Modern desktop and mobile browsers supporting WebGL 2.0 and WebAssembly: Chrome 90+, Safari 15+, Firefox 88+, Edge (Chromium).

**NF4 — Data provenance & licensing.** *(Added — required before public release.)*
All data sources must be license-compatible with public deployment. GTFS feeds are used under their published open-data terms; OpenStreetMap geometry requires ODbL attribution. Any scraped source must comply with the origin site's Terms of Service — scraping is a fallback only where no open feed exists, and its legal basis must be confirmed per source.

**NF5 — Accessibility & internationalization.** *(Added.)*
UI text supports Thai and English. Interactive controls meet WCAG 2.1 AA for contrast and keyboard operability where feasible within a 3D canvas app.

**NF6 — Maintainability & data refresh.** *(Added.)*
Timetable data is versioned; the preprocessing CLI is re-runnable to regenerate the binary cache when a new GTFS feed is published. Target refresh cadence: on each upstream feed update.

---

## 6. Proposed Project Folder Structure

```
tha-metro-mini-3d/
├── rust-engine/                 # Rust Wasm simulation core
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs               # Wasm bindings (wasm-bindgen)
│       ├── gtfs_parser.rs       # Binary schedule reader
│       ├── interpolation.rs     # Velocity curves & spatial solver
│       └── spatial.rs           # Track geometry & spline utilities
├── src/                         # Vite + React frontend
│   ├── assets/                  # Models (.glb), textures, icons
│   ├── components/              # UI overlay, line controls, inspector
│   │   ├── MapContainer.tsx
│   │   ├── ControlPanel.tsx
│   │   ├── TrainInspector.tsx
│   │   └── TimeScrubber.tsx
│   ├── map/                     # MapLibre & Three.js bridge
│   │   ├── ThreeLayer.ts        # Custom MapLibre WebGL layer
│   │   ├── VehicleManager.ts    # 3D model pool & transform updates
│   │   └── CameraController.ts  # Smooth follow & pitch logic
│   ├── stores/                  # State management (Zustand)
│   ├── types/                   # TypeScript interfaces
│   ├── App.tsx
│   └── main.tsx
├── tools/                       # CLI preprocessing tools
│   └── gtfs_preprocessor/       # Converts GTFS zip to optimized binary
├── index.html
├── vite.config.ts
└── package.json
```

---

## 7. Delivery Roadmap — MVP Ladder

The project is delivered as a sequence of **vertical, shippable MVPs** rather than horizontal technical layers. Each MVP is independently demonstrable and de-risks the next. The original phase work (data pipeline, Wasm core, map integration, motion, UI polish — see §7A) is distributed across these MVPs rather than done all at once.

Guiding principle: **prove the full render pipeline on one line before adding motion; prove motion on one line before adding breadth.**

### MVP 1 — Green Line track laid (geometry only, no trains)

**Goal:** Render the BTS Green Line as accurate, elevated 3D track over the MapLibre base map. This is the thinnest possible slice that exercises the entire visual pipeline end-to-end.

**Scope:** BTS Green Line = **Sukhumvit branch (light green) + Silom branch (dark green)**. *(Option to narrow to Sukhumvit-only for the very first slice; see §7B.)*

**In scope**

- Vite + TypeScript + React app shell; MapLibre GL JS base map centred on Bangkok.
- Three.js custom WebGL layer wired into MapLibre (the F3 bridge), including the `MercatorCoordinate` projection and camera-relative/floating-origin coordinate setup (§3A.4–3A.5).
- Green Line track geometry extracted to 3D GeoJSON with elevated Z-offsets (+12–22 m), spline-smoothed (F1.3).
- Track rendered as a 3D ribbon/line at correct elevation; station node markers placed.
- Free-camera orbit controls (subset of F3.2).

**Explicitly NOT in this MVP:** no trains, no motion, no timetable, no Wasm engine yet, no UI panels beyond basic map controls.

**Definition of done:** the Green Line's two branches appear as correctly-positioned elevated 3D track that stays glued to the map through pan/zoom/tilt, on the NF3 browser matrix, within the bundle budget so far.

**Why first:** it forces the hardest integration problem (MapLibre↔Three coordinate/depth/precision) to be solved on day one, with static geometry as the only variable. Everything else builds on this foundation.

### MVP 2 — Green Line data pipeline & static schedule

**Goal:** Stand up the offline preprocessing path and load a real timetable for the Green Line.

- Rust CLI preprocessor: GTFS ZIP → compact binary cache (§F1.1–F1.2), Green Line only.
- Client loads the binary timetable; parse/validate against source.
- Stops snapped onto the track shape; service-calendar resolution (`calendar.txt`).
- No motion yet — this MVP proves the data is correct and loadable, feeding MVP 3.

**Definition of done:** the Green Line timetable loads client-side under the <3 MB cache target and passes pipeline validation (trip/stop counts, calendars).

### MVP 3 — Green Line trains moving (single-line simulation)

**Goal:** Trains move along the Green Line on schedule. First "living" build.

- Rust→Wasm interpolation engine (F2.1): status resolution + `3p²−2p³` S-curve, exposed via the flat `Float32Array` transform-buffer API (§3A.2).
- Web Worker runs the sim tick; transforms delivered via transferable buffer (§3A.3); fixed-timestep sim with render-side interpolation (§3A.7).
- `InstancedMesh` train models coloured to line identity (F3.1, §3A.5); continuous yaw from track tangent (F2.2).
- Basic time-warp: 1×/5×/10×/60× and a real-time clock (F2.3).

**Definition of done:** Green Line trains dwell and transit on schedule at 60 FPS desktop, correct headings, no overshoot past termini.

### MVP 4 — Interaction & core UI (still Green Line)

**Goal:** Make the single line explorable and inspectable.

- Vehicle-follow (third-person) camera (F3.2).
- Station & vehicle inspector card: route, next-station ETA, origin/destination (F4.2).
- Time-scrubber / custom time picker (F2.3, `TimeScrubber.tsx`).
- Live timetable drawer for the selected station (F4.3).
- Zustand holds only UI-derived state, never per-frame kinematics (§3A.7).

**Definition of done:** a user can select a train, follow it, scrub time, and read live schedule info — a complete single-line product.

### MVP 5 — Multi-line breadth (elevated network)

**Goal:** Generalize from one line to many by making everything line-agnostic and adding the remaining **elevated** lines: MRT Purple, ARL, the Pink & Yellow monorails, the **BTS Gold Line** (short elevated automated people-mover — full track + trains), plus SRT Red (at-grade/elevated).

- Line selector to toggle visibility (F4.1).
- Monorail / APM (short-consist) vehicle models; per-line colours and structure types.
- Interchange metadata for the inspector.
- Performance validated toward the 300-concurrent-vehicle / <3 ms tick target (NF1).

**Definition of done:** all elevated + at-grade lines (including Gold) render and simulate together within performance budget.

### MVP 6 — Underground + environmental polish (full v1.0)

**Goal:** Complete the network and the "wow" layer.

- MRT Blue Line, including underground segments at −12 to −25 m.
- **MRT Orange Line — track geometry only** (no trains, no timetable), including its underground alignment. Reuses the MVP 1 track-rendering path; benefits from the same underground depth/transparency work. Rendered as a visually distinct "pre-revenue / not yet operational" line.
- Underground transparency mode — terrain/building opacity toggle with depth-buffer handling (F3.2, §3A.4); the hardest rendering feature, deliberately last.
- Dynamic day/night lighting and sun position (F3.3); shadow quality toggle (§3A.5).
- Glassmorphism UI pass; LOD tuning; final bundle-budget and cross-browser hardening (NF2/NF3).

**Definition of done:** full v1.0 scope (§2) shipped against all NF targets — every operational line simulated, Orange Line track laid and clearly marked pre-revenue.

### MVP summary

| MVP | Theme | Lines | Trains move? | Key requirements |
|-----|-------|-------|--------------|------------------|
| 1 | Track laid | Green only | No | F1.3, F3 bridge, §3A.4–3A.5 |
| 2 | Data pipeline | Green only | No | F1.1–F1.2, NF6 |
| 3 | Motion | Green only | **Yes** | F2, §3A.2–3A.3, 3A.7 |
| 4 | Interaction/UI | Green only | Yes | F3.2, F4.2–F4.3, F2.3 |
| 5 | Breadth | + Purple, ARL, Pink, Yellow, **Gold**, Red | Yes | F4.1, NF1 (scale) |
| 6 | Underground + polish | + MRT Blue; + **Orange (track only)** = full | Yes (Orange: track only) | F3.2 underground, F3.3, NF2 |

---

## 7A. Original Phase Mapping (reference)

The five technical phases from the initial proposal are preserved here and map onto the MVP ladder as follows:

| Phase | Milestone | Realized in |
|-------|-----------|-------------|
| 1 | Data pipelines & geometry | MVP 1 (geometry) + MVP 2 (timetable) |
| 2 | Wasm core engine | MVP 3 |
| 3 | Map & 3D integration | MVP 1 |
| 4 | Vehicle motion & interpolation | MVP 3 |
| 5 | UI controls & polish | MVP 4 (core UI) + MVP 6 (polish) |

## 7B. Optional narrower first slice

If an even smaller MVP 1 is desired to validate tooling fastest, scope it to the **Sukhumvit branch only** (single continuous alignment, no branch junction). This removes the Sukhumvit/Silom interchange-and-branch handling from the first slice and can be expanded to the full Green Line before MVP 2.

---

## 8. Out of Scope (v1.0) & Future Work

The following are explicitly excluded from v1.0 and recorded for future consideration:

- **GTFS-Realtime / live vehicle positions** — v1.0 is schedule-driven only.
- **Passenger routing / journey planning** — no trip-planning between stations.
- **Orange Line train simulation** — track geometry is in v1.0 (§7 MVP 6), but moving trains and a timetable are deferred until the line enters revenue service and a schedule is published.
- **Future line extensions** — planned or under-construction extensions of the in-scope lines (e.g., additional phases of existing lines) and any other lines beyond §2 are future work. When each opens, an operational line reuses the MVP 5/6 path (add feed → simulate), and a pre-revenue line reuses the Orange Line pattern (track geometry only).
- **Svelte UI variant** — React is the committed framework for v1.0.
- **Backend services / user accounts** — the app is a static, client-side deployment.

---

## 9. Assumptions & Dependencies

- A reasonably complete and current static GTFS feed is available for each in-scope line; where a feed is missing or incomplete, gaps are filled from OpenStreetMap geometry and documented.
- Station elevations are approximated from structure type (§F1.3) rather than surveyed values, unless authoritative altitude data is available.
- 3D train models are either sourced under a compatible license or produced in-house.
- End-user devices meet the WebGL 2.0 / WebAssembly baseline in NF3.

---

## 10. Testing & Acceptance Criteria *(Added)*

- **Data pipeline:** Preprocessor output validated against source GTFS (trip counts, stop sequences, service calendars) with automated checks.
- **Simulation correctness:** For a sampled set of trips, computed positions at known times match scheduled stop locations within tolerance; no train overshoots its terminus or renders while inactive.
- **Performance:** Frame-rate and Wasm tick-time targets (NF1) verified on reference hardware with 300 active vehicles.
- **Bundle size:** CI check enforces the ≤ 5 MB initial-load budget (NF2).
- **Cross-browser:** Smoke tests pass on the NF3 browser matrix.

---

## Appendix A — Glossary

| Term | Definition |
|------|-----------|
| **GTFS** | General Transit Feed Specification — open standard for static transit schedules and geometry. |
| **GTFS-Realtime** | Companion standard for live vehicle positions/alerts (out of scope, §8). |
| **Namtang / OTP** | Thailand's open transit data programme / Office of Transport and Traffic Policy and Planning. |
| **Wasm** | WebAssembly — portable binary instruction format run in the browser. |
| **LOD** | Level of Detail — swapping model complexity by distance for performance. |
| **Dwell** | Period a train is stopped at a station between arrival and departure. |
| **Smoothstep** | The `3p² − 2p³` easing curve used for acceleration/deceleration (§F2.1). |
| **Catmull-Rom / Bézier** | Spline methods used to smooth track geometry (§F1.3). |
