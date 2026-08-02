import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The live MapLibre instance, for the few things outside `MapContainer` that
 * genuinely need to drive the camera.
 *
 * A module-level ref rather than React context or store state, mirroring
 * `activeSimClient`: the map is an imperative object, not UI state, and
 * putting it in the store would re-render every subscriber whenever the
 * container remounted.
 *
 * Only the guided tour uses it today — it flies the camera to what each step
 * is describing. Anything on the per-frame path must keep going through the
 * layer's own render hook instead (SRS §3A.7).
 */
export const activeMap: { current: MapLibreMap | null } = { current: null };
