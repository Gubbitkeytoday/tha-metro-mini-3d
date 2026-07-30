import type { Map as MapLibreMap } from "maplibre-gl";
import { LANE_RUN_IDX, LANE_X, LANE_Y, VEHICLE_STRIDE, type StationInfo } from "../sim/protocol";
import { localToLngLat } from "./coordinates";

/**
 * Screen-space click picking for trains and stations (MVP 4).
 *
 * Both live in the local ENU meter frame, so candidates are projected to
 * screen pixels with `map.project()` and the nearest within a pixel radius
 * wins. This is deliberately NOT a Three.js raycast: the layer's projection
 * matrix is assembled per frame from MapLibre's, and there is no Three camera
 * with a real view matrix to raycast through.
 *
 * `map.project()` ignores altitude, so targets are compared at ground level.
 * At the 15 m track height that costs a few pixels of parallax under heavy
 * pitch, which the pick radius absorbs.
 */

/** Pixel radius within which a click counts as a hit. */
const VEHICLE_PICK_PX = 22;
const STATION_PICK_PX = 16;

export type Picked =
  | { type: "vehicle"; runIdx: number }
  | { type: "station"; routeIdx: number; stationIdx: number };

interface Point {
  x: number;
  y: number;
}

/**
 * Squared pixel distance to a candidate, or Infinity if it is not plausibly
 * on screen.
 *
 * Under heavy pitch, points beyond the horizon project to coordinates that can
 * land back inside the viewport, which would make a candidate behind the camera
 * a false hit. Rejecting anything outside the canvas (plus a margin for the
 * pick radius) closes that off cheaply.
 */
function screenDistanceSq(map: MapLibreMap, x: number, y: number, at: Point): number {
  const p = map.project(localToLngLat(x, y));
  const canvas = map.getCanvas();
  const margin = VEHICLE_PICK_PX;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (p.x < -margin || p.y < -margin || p.x > w + margin || p.y > h + margin) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = p.x - at.x;
  const dy = p.y - at.y;
  return dx * dx + dy * dy;
}

/**
 * Nearest train or station to a click, or null. Trains win ties inside their
 * radius — they sit on top of the station markers and are the smaller target.
 *
 * @param vehicles interpolated stride-8 records (SimClient.getInterpolated)
 * @param at click position in canvas pixels
 */
export function pickAt(
  map: MapLibreMap,
  vehicles: Float32Array,
  count: number,
  stations: StationInfo[],
  at: Point,
): Picked | null {
  let bestVehicle: { runIdx: number; d2: number } | null = null;
  for (let i = 0; i < count; i++) {
    const o = i * VEHICLE_STRIDE;
    const d2 = screenDistanceSq(map, vehicles[o + LANE_X], vehicles[o + LANE_Y], at);
    if (d2 <= VEHICLE_PICK_PX * VEHICLE_PICK_PX && (!bestVehicle || d2 < bestVehicle.d2)) {
      bestVehicle = { runIdx: vehicles[o + LANE_RUN_IDX], d2 };
    }
  }
  if (bestVehicle) return { type: "vehicle", runIdx: bestVehicle.runIdx };

  let bestStation: { station: StationInfo; d2: number } | null = null;
  for (const s of stations) {
    const d2 = screenDistanceSq(map, s.x, s.y, at);
    if (d2 <= STATION_PICK_PX * STATION_PICK_PX && (!bestStation || d2 < bestStation.d2)) {
      bestStation = { station: s, d2 };
    }
  }
  if (bestStation) {
    return {
      type: "station",
      routeIdx: bestStation.station.route_idx,
      stationIdx: bestStation.station.station_idx,
    };
  }
  return null;
}
