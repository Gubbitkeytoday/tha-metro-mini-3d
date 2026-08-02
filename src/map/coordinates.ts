import { MercatorCoordinate } from "maplibre-gl";
import type { LngLatAlt } from "../types";

/**
 * Floating-origin coordinate scheme (SRS §3A.5).
 *
 * WebGL runs on float32; absolute web-mercator coordinates at Bangkok's
 * latitude have too little precision left for city-scale geometry and cause
 * visible vertex jitter. So all Three.js geometry is built in a local
 * east/north/up METER frame relative to a fixed origin near the network
 * center, and the (float64) origin translation is folded into the camera
 * projection matrix each frame — never into vertex data.
 */

/** Local frame origin: Siam interchange, center of the Green Line network. */
export const ORIGIN_LNG_LAT: [number, number] = [100.5332, 13.7456];

const originMerc = MercatorCoordinate.fromLngLat(
  { lng: ORIGIN_LNG_LAT[0], lat: ORIGIN_LNG_LAT[1] },
  0,
);

/** Mercator units per meter at the origin's latitude. */
export const MERC_PER_METER = originMerc.meterInMercatorCoordinateUnits();

export const ORIGIN_MERC = { x: originMerc.x, y: originMerc.y };

/**
 * Project [lng, lat, altMeters] into the local ENU meter frame:
 * x = east, y = north, z = up. (Mercator y grows southward, hence the sign flip.)
 */
export function lngLatAltToLocal([lng, lat, alt]: LngLatAlt): [number, number, number] {
  const m = MercatorCoordinate.fromLngLat({ lng, lat }, 0);
  return [
    (m.x - ORIGIN_MERC.x) / MERC_PER_METER,
    -(m.y - ORIGIN_MERC.y) / MERC_PER_METER,
    alt,
  ];
}

/**
 * MapLibre's default vertical field of view, in radians (36.87°). Used to turn
 * "how tall is the viewport" into "how far back is the camera".
 */
const MAPLIBRE_FOV = 0.6435011087932844;

/** MapLibre's tile size in CSS pixels — one world is 512 * 2^zoom px across. */
const TILE_SIZE_PX = 512;

/** Equatorial circumference, matching MapLibre's mercator scale. */
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/**
 * Where the viewer actually is, in the local ENU meter frame.
 *
 * `ThreeLayer`'s camera is a bare matrix holder — the floating-origin scheme
 * folds MapLibre's mercator→clip matrix into `projectionMatrix` and leaves the
 * camera's world transform as the identity — so `camera.position` is the
 * origin, not the viewer. Anything that has to know where the viewer is
 * (billboarding a label, fading it by distance) has to reconstruct it.
 *
 * Derived from public map state only. MapLibre v6 removed
 * `getFreeCameraOptions()`, and `map.transform.cameraPosition` is marked
 * `@internal`, so depending on either would be building on sand; this is the
 * same camera model, computed from `center`/`zoom`/`pitch`/`bearing`.
 */
export function cameraLocalPosition(view: {
  center: { lng: number; lat: number };
  zoom: number;
  pitchDeg: number;
  bearingDeg: number;
  /** Viewport height in CSS pixels. */
  heightPx: number;
}): [number, number, number] {
  const { center, zoom, pitchDeg, bearingDeg, heightPx } = view;

  // Distance from the camera to the point it is centred on, in pixels, then
  // in metres at this latitude and zoom.
  const cameraToCenterPx = (0.5 / Math.tan(MAPLIBRE_FOV / 2)) * heightPx;
  const metresPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((center.lat * Math.PI) / 180)) /
    (TILE_SIZE_PX * Math.pow(2, zoom));
  const distanceM = cameraToCenterPx * metresPerPixel;

  const pitch = (pitchDeg * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;

  // Pitch 0 is straight down, so the camera is directly overhead; pitching
  // swings it back along the bearing it is looking *from*, hence the minus.
  const groundOffsetM = distanceM * Math.sin(pitch);
  const [cx, cy] = lngLatAltToLocal([center.lng, center.lat, 0]);

  return [
    cx - groundOffsetM * Math.sin(bearing),
    cy - groundOffsetM * Math.cos(bearing),
    distanceM * Math.cos(pitch),
  ];
}

/**
 * Inverse of {@link lngLatAltToLocal} — local ENU meters back to [lng, lat].
 * Needed to hand engine-frame positions (vehicles, stations) to MapLibre APIs
 * that speak LngLat: `map.project()` for click hit-testing and `jumpTo()` for
 * the follow camera.
 */
export function localToLngLat(x: number, y: number): { lng: number; lat: number } {
  const merc = new MercatorCoordinate(
    ORIGIN_MERC.x + x * MERC_PER_METER,
    ORIGIN_MERC.y - y * MERC_PER_METER,
    0,
  );
  const { lng, lat } = merc.toLngLat();
  return { lng, lat };
}
