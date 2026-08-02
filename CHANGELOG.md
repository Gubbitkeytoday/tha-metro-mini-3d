# Changelog

Notable changes, newest first. Dates are the day the work landed.

The project is built in vertical MVP slices rather than horizontal layers — see
the [roadmap](./README.md#roadmap) — so each entry below is a demoable
increment, not a batch of internal refactors.

## 2026-08-02 — Search, journey planning, and two real data defects fixed

### Added

- **Station search and a journey planner** (`src/routing/`). A station is found
  by any name it has in any language, or by its code (`E4`); a trip is planned
  over a graph whose nodes are *platforms* — `(routeIdx, stationIdx)` — so
  "change at Asok" falls out of Dijkstra rather than being special-cased.
  Running times come from the published timetable via one sampled run per route,
  not from an assumed speed. The transfer penalty is a deliberately generous
  300 s: for the newcomer this is built for, one fewer change beats five minutes
  saved. 14 browser checks (`npm run verify:planner`), 29 unit tests.
- A guided-tour step for the planner, translated into all nine languages.
- **A PromptPay support code**, generated at build time
  (`npm run promptpay:qr`) from a tested EMVCo payload builder and committed as
  an SVG, with the account digits printed beside it so a payer can check one
  against the other.
- **A generated screenshot gallery and demo video** (`npm run media`,
  `npm run media:video`) — scripted from the running app at a pinned simulated
  time, so they can be regenerated rather than drifting out of date.
- `npm run wasm:build:docker` — the Wasm engine can now be rebuilt without a
  working host Rust toolchain.
- `network.report.json` now reports `max_leg_kmh`, `implausible_legs` and
  `zero_travel_legs_repaired`.

### Fixed

- **MRT Blue's loop no longer produces 38 km schedule legs.** The line serves
  Tha Phra twice but its geometry is one stitched polyline, so snapping each
  stop to its *nearest* arc position sent nine legs the wrong way round the
  circle — Tha Phra ↔ จรัญฯ 13 measured 38.3 km against a scheduled 150 s, a
  train crossing the city at ~900 km/h. The preprocessor now keeps every
  candidate arc position per stop and chooses per trip, by exact DP over the
  whole stop sequence. No cache-format change.
- **Six MRT Blue trips in the feed publish zero travel time between stations**
  (`arrival = 60i, departure = 60(i+1)`), which made trains stand still and then
  teleport 1.4 km. Dwell is now capped so every leg has time to be travelled —
  145 stops adjusted, arrival times untouched.
- **A vehicle's identity is now `run_idx` plus a service-day tag.** Around the
  midnight rollover both copies of a run can be live at opposite ends of a line;
  sharing one id made the render-side interpolation streak a train across the
  city.
- `verify:kinematics` consequently passes repeatedly rather than intermittently:
  maximum displacement over four seconds fell from ~2 km to ~130 m.

## 2026-08-02 — MVP 6: underground, day/night and polish

MRT Blue added (GTFS route 3, OSM relation 444659) — **10 lines, 193 stations,
58 patterns, 8,193 runs**. Track structure became per-OSM-way rather than
per-line, so Blue renders viaduct–tunnel–viaduct for real and portals ramp
instead of stepping. Also: see-through tunnels, clock-driven day/night from a
real solar-position calculation, floating 3D station labels with screen-space
decluttering, a shadow-quality toggle, a glassmorphism pass, and a full
responsive/touch pass from 320 px to desktop.

**MRT Orange is not included and cannot be yet** — no OpenStreetMap route
relation exists to source its geometry from (swept live 2026-08-02 across
`route=subway|train|light_rail|monorail`, `route=construction` and
`construction:route`/`proposed:route`; zero candidates). Its alignment will not
be synthesised from memory.

Alongside it: nine-language interface with station names from OpenStreetMap's
`name:<lang>` tags, opt-in GPS with a metre-accurate halo, a 3D-buildings
switch, a thirteen-step spotlight tour, an About/privacy panel, SEO and social
cards, and no cookies or analytics of any kind.

## 2026-07-31 — MVP 5: multi-line breadth

Generalised every line-specific code path to a registry (`tools/lines.config.mjs`)
and grew from 2 lines to 9: Sukhumvit, Silom, Purple, ARL, Pink, Yellow, Gold,
SRT Dark Red, SRT Light Red — 155 stations, 4,481 runs. Line selector,
cross-route interchange metadata, and monorail/APM/commuter vehicle models.

Surfaced and fixed real pipeline gaps along the way: an OSM node-id type
mismatch, the Pink Line's Muang Thong Thani spur sharing a GTFS route id with
the main line, a GTFS/OSM coordinate mismatch at Pink's own terminus, and OSM
stop-position nodes without name tags silently blanking station names.

## Earlier — MVP 1 to 4

1. **MVP 1** — app shell, MapLibre base map, the Three.js custom-layer bridge
   and floating-origin coordinates, BTS Green Line 3D track, free-camera orbit.
2. **MVP 2** — Rust GTFS preprocessor to a binary cache, client-side load and
   validation, stop snapping, calendar resolution.
3. **MVP 3** — the Wasm interpolation engine in a Web Worker over transferable
   buffers, `InstancedMesh` trains, 1×/5×/10×/60× time warp.
4. **MVP 4** — click-to-select trains and stations, follow camera, train
   inspector, live station board, time scrubber.
