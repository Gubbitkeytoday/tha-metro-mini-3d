import { Marker, type Map as MapLibreMap } from "maplibre-gl";

/**
 * Live GPS position ("where am I on this network?").
 *
 * Deliberately **opt-in**: nothing here runs until the user presses the locate
 * button. Browsers gate `geolocation` behind a permission prompt anyway, and
 * firing that prompt on page load — before the user has any idea what the app
 * is — is both hostile and the fastest way to get permanently denied.
 *
 * Uses `watchPosition`, not repeated `getCurrentPosition`: the browser then
 * pushes updates as the device's own fix improves or moves, which is what
 * "realtime" means here, and it lets the OS batch GPS wake-ups instead of the
 * page polling the radio.
 *
 * The dot is a MapLibre `Marker` (a DOM element MapLibre keeps positioned) and
 * the accuracy halo is a GeoJSON circle layer, rather than more Three
 * geometry: both are single objects, MapLibre already projects them correctly,
 * and neither belongs on the simulation's per-frame path.
 */

const ACCURACY_SOURCE = "user-location-accuracy";
const ACCURACY_LAYER = "user-location-accuracy-fill";

export type GeolocationStatus =
  | { state: "off" }
  | { state: "locating" }
  | { state: "tracking"; lng: number; lat: number; accuracyM: number }
  | { state: "error"; message: string };

export class UserLocation {
  private watchId: number | null = null;
  private marker: Marker | null = null;
  private map: MapLibreMap | null = null;
  private onStatus: (status: GeolocationStatus) => void;
  /** Recentre on the next fix only — set when the user presses locate. */
  private recentreOnNextFix = false;

  constructor(onStatus: (status: GeolocationStatus) => void) {
    this.onStatus = onStatus;
  }

  get isTracking(): boolean {
    return this.watchId !== null;
  }

  /** Begin (or restart) tracking, recentring the map on the first fix. */
  start(map: MapLibreMap): void {
    this.map = map;
    if (!("geolocation" in navigator)) {
      this.onStatus({
        state: "error",
        message: "This browser has no geolocation support.",
      });
      return;
    }
    this.recentreOnNextFix = true;
    if (this.watchId !== null) return;

    this.onStatus({ state: "locating" });
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.onFix(position),
      (error) => this.onError(error),
      {
        // The point is to place the user on a specific platform, so the coarse
        // network fix is not good enough.
        enableHighAccuracy: true,
        // A fix older than 15 s is stale for someone on a moving train.
        maximumAge: 15_000,
        timeout: 20_000,
      },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.marker?.remove();
    this.marker = null;
    this.removeAccuracyCircle();
    this.onStatus({ state: "off" });
  }

  /** Tear down without emitting status — for component unmount. */
  dispose(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.marker?.remove();
    this.marker = null;
    this.map = null;
  }

  private onFix(position: GeolocationPosition): void {
    const map = this.map;
    if (!map) return;
    const { longitude: lng, latitude: lat, accuracy } = position.coords;

    if (!this.marker) {
      this.marker = new Marker({ element: buildDot() }).setLngLat([lng, lat]).addTo(map);
    } else {
      this.marker.setLngLat([lng, lat]);
    }

    this.updateAccuracyCircle(map, lng, lat, accuracy);

    if (this.recentreOnNextFix) {
      this.recentreOnNextFix = false;
      // easeTo, not jumpTo: an instant teleport across the city is
      // disorienting, and the user just asked to be taken somewhere.
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: 1200 });
    }

    this.onStatus({ state: "tracking", lng, lat, accuracyM: accuracy });
  }

  private onError(error: GeolocationPositionError): void {
    const message =
      error.code === error.PERMISSION_DENIED
        ? "Location permission denied."
        : error.code === error.POSITION_UNAVAILABLE
          ? "No position available — no GPS or network fix."
          : error.code === error.TIMEOUT
            ? "Timed out waiting for a fix."
            : error.message || "Could not get a location.";
    // A denial is permanent until the user changes it in the browser, so stop
    // watching rather than sitting in a retry loop against a closed door.
    if (error.code === error.PERMISSION_DENIED) this.stop();
    this.onStatus({ state: "error", message });
  }

  /**
   * The accuracy halo, as a real circle on the ground.
   *
   * Drawn as a polygon in a GeoJSON source rather than a `circle` layer with a
   * pixel radius, because accuracy is a distance in METRES — a pixel-radius
   * circle would keep its size as you zoom and quietly misrepresent how well
   * the device actually knows where it is.
   */
  private updateAccuracyCircle(
    map: MapLibreMap,
    lng: number,
    lat: number,
    accuracyM: number,
  ): void {
    const data = circlePolygon(lng, lat, accuracyM);
    const existing = map.getSource(ACCURACY_SOURCE);
    if (existing && "setData" in existing) {
      (existing as { setData: (d: unknown) => void }).setData(data);
      return;
    }
    map.addSource(ACCURACY_SOURCE, { type: "geojson", data } as never);
    map.addLayer(
      {
        id: ACCURACY_LAYER,
        type: "fill",
        source: ACCURACY_SOURCE,
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 },
      } as never,
      // Beneath the 3D layer so track and trains stay on top of it.
      map.getLayer("network-3d") ? "network-3d" : undefined,
    );
  }

  private removeAccuracyCircle(): void {
    const map = this.map;
    if (!map) return;
    try {
      if (map.getLayer(ACCURACY_LAYER)) map.removeLayer(ACCURACY_LAYER);
      if (map.getSource(ACCURACY_SOURCE)) map.removeSource(ACCURACY_SOURCE);
    } catch {
      // Style torn down first — nothing to remove.
    }
  }
}

/** The blue dot. Plain DOM so it can use a CSS pulse and stays crisp. */
function buildDot(): HTMLElement {
  const el = document.createElement("div");
  el.className = "user-location-dot";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/**
 * An `accuracyM`-radius circle around (lng, lat) as a GeoJSON polygon.
 *
 * Latitude is scaled by cos(lat) so the shape is a true circle on the ground
 * rather than an ellipse — at Bangkok's latitude the error would be ~3%.
 */
export function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64) {
  const metresPerDegLat = 111_320;
  const metresPerDegLng = metresPerDegLat * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      lng + (Math.cos(angle) * radiusM) / metresPerDegLng,
      lat + (Math.sin(angle) * radiusM) / metresPerDegLat,
    ]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}
