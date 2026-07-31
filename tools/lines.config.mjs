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
  }
}
