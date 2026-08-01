/**
 * Line registry — the single source of truth for line identity across the
 * Overpass fetcher, the Rust preprocessor and the frontend renderer.
 *
 * ORDER IS LOAD-BEARING: index in LINES == network.json lines[i]
 * == cache routes[i] == vehicle-buffer route_idx (contract §3 lane 6).
 * Appending is safe; reordering or removing invalidates a committed .tmb.
 *
 * `gtfsRouteId: null` means "track geometry only" — rendered, never simulated
 * (the MVP 6 Orange Line pattern, also the fallback when a feed omits a line).
 */

/** Nominal deck heights, SRS §F1.3 (elevated +12..+22, at-grade +0.5). */
export const STRUCTURE_ALTITUDE_M = {
  elevated: 15,
  atGrade: 0.5,
  underground: -18,
};

export const VEHICLE_TYPES = ["heavy", "monorail", "apm", "commuter"];

/**
 * Classify one OSM way as underground / elevated / at-grade from its
 * tunnel/bridge/layer tags.
 *
 * Duplicated from src/map/structure.ts because this file runs in plain node
 * (the fetcher imports it directly) and cannot import a .ts module. Keep the
 * two copies in sync — lines.config.test.mjs asserts they agree on the same
 * cases structure.test.ts checks for the TS copy.
 *
 * `tunnel=building_passage` is a deliberate exception: OSM uses it for track
 * running through/under a building, not a physically bored tunnel. Verified
 * against real Bangkok data — both SRT Dark Red and Light Red are tagged
 * tunnel=building_passage + layer=1 (positive) + covered=yes at Bang Sue
 * Grand Station, and the SRT Red lines have no underground track anywhere.
 * Falls through to bridge/layer/fallback, same as tunnel=no.
 */
export function structureOfWay(tags, fallback = "elevated") {
  const tunnel = tags.tunnel;
  if (tunnel && tunnel !== "no" && tunnel !== "building_passage") return "underground";
  const bridge = tags.bridge;
  if (bridge && bridge !== "no") return "elevated";
  if (tunnel === "no" || bridge === "no") return "elevated";
  const layer = Number.parseInt(tags.layer ?? "", 10);
  if (Number.isFinite(layer) && layer < 0) return "underground";
  if (Number.isFinite(layer) && layer > 0) return "elevated";
  return fallback;
}

export const LINES = [
  {
    key: "sukhumvit",
    name: "Sukhumvit Line",
    nameTh: "สายสุขุมวิท",
    color: "#7CB342",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    osm: { relationId: 444651, match: /sukhumvit/i },
  },
  {
    key: "silom",
    name: "Silom Line",
    nameTh: "สายสีลม",
    color: "#00877C",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "2",
    osm: { relationId: 2067854, match: /silom/i },
  },
  {
    key: "purple",
    name: "MRT Purple Line",
    nameTh: "สายสีม่วง",
    // Feed route_color (660066) differs from the conventional #7E57C2 livery
    // swatch — using the feed's value per tools/inspect-gtfs.mjs.
    color: "#660066",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "4",
    osm: { relationId: 6988563, match: /purple/i },
  },
  {
    key: "arl",
    name: "Airport Rail Link",
    nameTh: "แอร์พอร์ต เรล ลิงก์",
    // Feed route_color (E32020) differs from the conventional #D32F2F swatch.
    color: "#E32020",
    structure: "elevated",
    vehicleType: "commuter",
    gtfsRouteId: "5",
    osm: { relationId: 2148241, match: /airport rail link/i },
  },
  {
    key: "pink",
    name: "MRT Pink Line",
    nameTh: "สายสีชมพู",
    // Feed route_color (cd4692) differs from the conventional #EC407A swatch.
    color: "#CD4692",
    structure: "elevated",
    vehicleType: "monorail",
    gtfsRouteId: "2436",
    osm: { relationId: 16740886, match: /pink/i },
    // The Namtang feed bundles the Muang Thong Thani spur's 4 shuttle trip
    // patterns (stop_ids 16936 "Impact Muang Thong Thani" / 16937 "Lake
    // Muang Thong Thani") into this SAME route_id alongside the 30-station
    // main line — discovered when the preprocessor's snap check hard-failed
    // (those 2 stops are ~1.2 km off the main-line-only track fetched
    // above). The spur is a real, separate physical branch (relation pair
    // 19149752/19150155 in OSM) whose own track geometry is out of scope
    // for this registry entry (see docs/SRS.md §2's caveat block) — until a
    // future task adds it as its own line, drop these 2 stops (and the
    // trips that serve them) rather than mis-snapping them onto the trunk.
    excludeGtfsStopIds: ["16936", "16937"],
    // GTFS stop 359 ("MRT Nonthaburi Civic Center", the Pink Line's own
    // western terminus) is 555 m from where this line's fetched track ends
    // — but that's a GTFS coordinate quirk, not a stitching bug: the
    // Namtang feed's lat/lng for stop 359 is 8 m from OSM node 5222843684
    // (MRT Purple, ref PP11) — the Purple-side half of this interchange —
    // while the real Pink-side platform (OSM node 11364308559, ref PK01)
    // is 555 m away and matches this line's fetched track endpoint to
    // within 2.7 m. Verified via a direct Overpass node-tag lookup
    // (2026-07-31); allowing the large snap keeps the real terminus in
    // simulation instead of failing the whole route or dropping it.
    allowLargeSnapStopIds: ["359"],
  },
  {
    key: "yellow",
    name: "MRT Yellow Line",
    nameTh: "สายสีเหลือง",
    // Feed route_color (FFE547) is a very pale yellow that reads as nearly
    // invisible against the basemap's tan/beige — unlike the other lines'
    // feed-vs-conventional mismatches (a few degrees of hue/saturation), this
    // one is a legibility problem, not just a stylistic difference. Uses the
    // conventional MRT Yellow swatch instead.
    color: "#FBC02D",
    structure: "elevated",
    vehicleType: "monorail",
    gtfsRouteId: "2224",
    osm: { relationId: 15806897, match: /yellow/i },
  },
  {
    key: "gold",
    name: "BTS Gold Line",
    nameTh: "สายสีทอง",
    // Feed route_color (A3862A) differs from the conventional #C9A227 swatch.
    color: "#A3862A",
    structure: "elevated",
    vehicleType: "apm",
    gtfsRouteId: "2025",
    osm: { relationId: 11681439, match: /gold/i },
  },
  {
    key: "red-dark",
    name: "SRT Dark Red Line",
    nameTh: "สายสีแดงเข้ม",
    // Feed route_color (e10506) differs from the conventional #B71C1C swatch.
    color: "#E10506",
    // Default (untagged-way fallback) is atGrade, not elevated: SRT commuter
    // rail is fundamentally ground-level track with elevated viaduct sections
    // through the city core near Bang Sue Grand Station, the opposite mix of
    // every other (fully-elevated) line in this registry. Verified against
    // real OSM way tags (2026-08-01): of 23 track ways, 17 carry an explicit
    // bridge/positive-layer tag (elevated) and the other 6 carry neither
    // (4 bare, 2 embankment=yes) — embankment is raised earthwork, not a
    // viaduct, so it reads as atGrade same as an untagged way.
    structure: "atGrade",
    vehicleType: "commuter",
    gtfsRouteId: "2026",
    osm: { relationId: 13058384, match: /dark red|red line.*rangsit/i },
  },
  {
    key: "red-light",
    name: "SRT Light Red Line",
    nameTh: "สายสีแดงอ่อน",
    // Feed route_color (fd5353) differs from the conventional #EF5350 swatch.
    color: "#FD5353",
    // Same reasoning as red-dark above: 10 of 19 ways carry an explicit
    // bridge/positive-layer tag, the other 9 (7 bare, 2 embankment=yes) fall
    // through to this atGrade default.
    structure: "atGrade",
    vehicleType: "commuter",
    gtfsRouteId: "2027",
    osm: { relationId: 13178788, match: /light red|red line.*taling chan/i },
  },
];

/**
 * Interchanges the 300 m radius cannot see — long paid/unpaid walkways.
 * Entries are line-qualified: a bare stop-id pair would link every route
 * that happens to reuse that id (Namtang reuses ids across operators).
 */
export const INTERCHANGE_OVERRIDES = [
  // MRT Purple <-> MRT Pink, Nonthaburi Civic Center. The Namtang feed uses
  // the SAME gtfs_stop_id (359) on both lines' schedules, but the platforms
  // are ~555 m apart (Purple's PP11 vs Pink's PK01, confirmed against OSM
  // node tags — see the allowLargeSnapStopIds note on the `pink` entry).
  { aLine: "purple", aStop: "359", bLine: "pink", bStop: "359" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Throws on any registry mistake that would corrupt the index invariant. */
export function assertRegistryValid(lines = LINES) {
  const keys = new Set();
  const routeIds = new Set();
  for (const l of lines) {
    if (keys.has(l.key)) throw new Error(`duplicate line key '${l.key}'`);
    keys.add(l.key);
    if (l.gtfsRouteId !== null) {
      if (routeIds.has(l.gtfsRouteId)) {
        throw new Error(`duplicate gtfsRouteId '${l.gtfsRouteId}'`);
      }
      routeIds.add(l.gtfsRouteId);
    }
    if (!(l.structure in STRUCTURE_ALTITUDE_M)) {
      throw new Error(`${l.key}: unknown structure '${l.structure}'`);
    }
    if (!VEHICLE_TYPES.includes(l.vehicleType)) {
      throw new Error(`${l.key}: unknown vehicleType '${l.vehicleType}'`);
    }
    if (!HEX.test(l.color)) throw new Error(`${l.key}: color must be #RRGGBB`);
    for (const field of ["excludeGtfsStopIds", "allowLargeSnapStopIds"]) {
      const v = l[field];
      if (v === undefined) continue;
      if (!Array.isArray(v) || !v.every((id) => typeof id === "string" && id.length > 0)) {
        throw new Error(`${l.key}: ${field} must be an array of non-empty strings`);
      }
    }
  }

  for (const o of INTERCHANGE_OVERRIDES) {
    for (const side of ["a", "b"]) {
      if (!keys.has(o[`${side}Line`])) {
        throw new Error(`interchange override names unknown line '${o[`${side}Line`]}'`);
      }
    }
  }
}
