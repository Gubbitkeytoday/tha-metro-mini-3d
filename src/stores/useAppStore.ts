import { create } from "zustand";
import { preferredLanguage, urlLanguage } from "../i18n/languages";
import { loadPreferences, savePreferences } from "../lib/preferences";
import type { GeolocationStatus } from "../map/geolocation";
import type { StationInfo, ValidationSummary } from "../sim/protocol";
import type { ClockParams } from "../sim/SimClient";
import type { LineGeometry } from "../types";

/**
 * UI-facing state only (SRS §3A.7): per-frame render/kinematic state must
 * never live here — Zustand state changes trigger React re-renders. Vehicle
 * buffers stay inside SimClient/VehicleManager; only slow-changing engine
 * status, clock params (rebased on warp change) and a 1 Hz-throttled vehicle
 * count pass through the store (ENGINE_CONTRACT.md §6).
 */

export type EngineStatus = "off" | "loading" | "ready" | "error";
export type Warp = 1 | 5 | 10 | 60;
export type LightingMode = "auto" | "day" | "night";

interface AppState {
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;

  engineStatus: EngineStatus;
  engineError: string | null;
  setEngineStatus: (status: EngineStatus, error?: string) => void;

  validation: ValidationSummary | null;
  setValidation: (validation: ValidationSummary | null) => void;

  /** Sim clock params — simNow = clockEpochMs + (perfNow - clockSetAt) * warp. */
  warp: Warp;
  clockEpochMs: number;
  clockSetAt: number;
  setClock: (params: ClockParams) => void;

  /** Throttled to 1 Hz by MapContainer — never per-frame. */
  vehicleCount: number;
  setVehicleCount: (count: number) => void;

  // ---- MVP 4 selection (UI-derived; the pose itself stays out of here) ----

  /** Selected train, identified by its run index (vehicle lane 5). */
  selectedRunIdx: number | null;
  /** Selected station, as the indices the engine's board query takes. */
  selectedStation: { routeIdx: number; stationIdx: number } | null;
  /** Third-person camera locked to the selected train (F3.2). */
  following: boolean;

  /** Selecting a train clears any station selection, and vice versa. */
  selectRun: (runIdx: number | null) => void;
  selectStation: (station: { routeIdx: number; stationIdx: number } | null) => void;
  setFollowing: (following: boolean) => void;

  /** Static station list from the engine, fetched once at ready. */
  stations: StationInfo[];
  setStations: (stations: StationInfo[]) => void;

  // ---- MVP 5 line visibility (F4.1) ----

  /** Line table from network.json, index == route_idx. */
  routes: LineGeometry[];
  setRoutes: (routes: LineGeometry[]) => void;

  /** Route indices the user has switched off (F4.1). Array, not Set —
   *  Zustand equality checks are reference-based and a Set mutated in place
   *  would not re-render. */
  hiddenRoutes: number[];
  toggleRoute: (routeIdx: number) => void;
  isRouteVisible: (routeIdx: number) => boolean;

  // ---- MVP 6 scene modes ----

  /** See-through tunnels for below-ground track (F3.2). */
  undergroundVisible: boolean;
  setUndergroundVisible: (visible: boolean) => void;

  /** Floating 3D station-name labels. */
  showStationLabels: boolean;
  setShowStationLabels: (show: boolean) => void;

  /**
   * Shadow maps inside the 3D layer (SRS §3A.5's quality toggle). Off by
   * default: it only shadows track and trains against each other — MapLibre
   * owns the city's buildings — so it costs a shadow pass for a modest gain,
   * which is exactly the trade the toggle exists to let the user make.
   */
  shadows: boolean;
  setShadows: (on: boolean) => void;

  /**
   * The base map's 3D building extrusions. On by default (they give the city
   * its shape and depth-occlude elevated track correctly), but they also hide
   * trains from a low camera and are the most expensive thing the base map
   * draws — so they are switchable.
   */
  buildings: boolean;
  setBuildings: (on: boolean) => void;

  // ---- Language ----

  /**
   * The one language everything is shown in — UI chrome and station names
   * alike. Picking Thai means Thai, picking English means English; labels
   * never stack two languages.
   */
  language: string;
  setLanguage: (language: string) => void;

  // ---- GPS ----

  /** Latest geolocation status; `off` until the user asks to be located. */
  locationStatus: GeolocationStatus;
  setLocationStatus: (status: GeolocationStatus) => void;

  /**
   * Toggle location tracking. The actual `UserLocation` instance belongs to
   * `MapContainer` (it needs the map), so the component registers its handler
   * here and the UI calls this — rather than the store owning a browser API or
   * the button reaching into the map.
   */
  requestLocation: () => void;
  setLocationHandler: (handler: (() => void) | null) => void;

  /**
   * Lighting policy. `auto` follows the simulated clock's real sun position
   * (F3.3) — scrub to 06:00 and it is dawn; `day`/`night` pin it, which is
   * what you want when comparing something across times of day.
   */
  lightingMode: LightingMode;
  setLightingMode: (mode: LightingMode) => void;

  /**
   * Whether the scene is *currently* rendering as night. Derived: under
   * `auto` it is recomputed from the sun, otherwise it mirrors the pinned
   * mode. Kept in the store rather than recomputed in each component so the
   * base-map repaint and the UI can never disagree about it.
   */
  night: boolean;
  setNight: (night: boolean) => void;

  // ---- Onboarding & about ----

  /** The step-by-step first-run tour. */
  tourOpen: boolean;
  setTourOpen: (open: boolean) => void;

  /** The about / privacy / support panel. */
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;

  /**
   * Whether the line/view panel is expanded. `null` means "follow the
   * viewport" (open on a laptop, collapsed on a phone).
   *
   * Lifted out of LineSelector because the guided tour has to open the panel
   * before it can spotlight a control inside it — a highlight anchored to an
   * element that is not rendered has nothing to point at.
   */
  panelExpanded: boolean | null;
  setPanelExpanded: (expanded: boolean | null) => void;

  /** Station search and journey planner. */
  plannerOpen: boolean;
  setPlannerOpen: (open: boolean) => void;
}

/**
 * Held outside the store on purpose: it is a callback into an imperative
 * browser-API owner, not UI state, and putting it in the store would make
 * every subscriber re-render whenever MapContainer remounted.
 */
let locationHandler: (() => void) | null = null;

/**
 * View settings from the visitor's last session, read once at module load.
 *
 * Read synchronously rather than applied in an effect so the first render is
 * already correct — otherwise the map builds its labels in the wrong language
 * and rebuilds them a frame later, which is both visible and wasteful.
 */
const stored = loadPreferences();

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  setMapReady: (ready) => set({ mapReady: ready }),

  engineStatus: "off",
  engineError: null,
  setEngineStatus: (status, error) => set({ engineStatus: status, engineError: error ?? null }),

  validation: null,
  setValidation: (validation) => set({ validation }),

  warp: 1,
  clockEpochMs: Date.now(),
  clockSetAt: 0,
  setClock: ({ clockEpochMs, clockSetAt, warp }) =>
    set({ clockEpochMs, clockSetAt, warp: warp as Warp }),

  vehicleCount: 0,
  setVehicleCount: (count) => set({ vehicleCount: count }),

  selectedRunIdx: null,
  selectedStation: null,
  following: false,

  selectRun: (runIdx) =>
    set(
      runIdx === null
        ? { selectedRunIdx: null, following: false }
        : { selectedRunIdx: runIdx, selectedStation: null },
    ),
  selectStation: (station) =>
    set(
      station === null
        ? { selectedStation: null }
        : { selectedStation: station, selectedRunIdx: null, following: false },
    ),
  setFollowing: (following) => set({ following }),

  stations: [],
  setStations: (stations) => set({ stations }),

  routes: [],
  setRoutes: (routes) => set({ routes }),

  hiddenRoutes: stored.hiddenRoutes ?? [],
  toggleRoute: (routeIdx) =>
    set((s) => ({
      hiddenRoutes: s.hiddenRoutes.includes(routeIdx)
        ? s.hiddenRoutes.filter((r) => r !== routeIdx)
        : [...s.hiddenRoutes, routeIdx],
    })),
  isRouteVisible: (routeIdx) => !get().hiddenRoutes.includes(routeIdx),

  undergroundVisible: stored.undergroundVisible ?? false,
  setUndergroundVisible: (undergroundVisible) => set({ undergroundVisible }),

  showStationLabels: stored.showStationLabels ?? true,
  setShowStationLabels: (showStationLabels) => set({ showStationLabels }),

  shadows: stored.shadows ?? false,
  setShadows: (shadows) => set({ shadows }),

  buildings: stored.buildings ?? true,
  setBuildings: (buildings) => set({ buildings }),

  // Start in whichever of the app's languages the browser actually asks for,
  // rather than defaulting every visitor to English in a Thai city.
  // ?lang= first (a shared or indexed link must open in the language it
  // names), then the visitor's saved choice, then their browser's.
  language: urlLanguage() ?? stored.language ?? preferredLanguage(),
  setLanguage: (language) => set({ language }),

  locationStatus: { state: "off" },
  setLocationStatus: (locationStatus) => set({ locationStatus }),

  requestLocation: () => locationHandler?.(),
  setLocationHandler: (handler) => {
    locationHandler = handler;
  },

  lightingMode: stored.lightingMode ?? "auto",
  setLightingMode: (lightingMode) => set({ lightingMode }),

  night: false,
  setNight: (night) => set({ night }),

  tourOpen: false,
  setTourOpen: (tourOpen) => set({ tourOpen }),

  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  panelExpanded: null,
  setPanelExpanded: (panelExpanded) => set({ panelExpanded }),

  plannerOpen: false,
  setPlannerOpen: (plannerOpen) => set({ plannerOpen }),
}));

/**
 * Persist the view settings whenever one of them changes.
 *
 * A subscription rather than a write inside each setter: there are eight of
 * them, and a single place to decide what is persisted is also the single
 * place to audit that nothing personal ever gets written (see
 * `src/lib/preferences.ts` for why that matters).
 *
 * `night` is deliberately NOT stored — it is derived from the lighting mode
 * and the clock, so saving it would let a stale value fight the sun.
 */
useAppStore.subscribe((state, prev) => {
  if (
    state.language === prev.language &&
    state.showStationLabels === prev.showStationLabels &&
    state.undergroundVisible === prev.undergroundVisible &&
    state.buildings === prev.buildings &&
    state.shadows === prev.shadows &&
    state.lightingMode === prev.lightingMode &&
    state.hiddenRoutes === prev.hiddenRoutes
  ) {
    return;
  }
  savePreferences({
    language: state.language,
    showStationLabels: state.showStationLabels,
    undergroundVisible: state.undergroundVisible,
    buildings: state.buildings,
    shadows: state.shadows,
    lightingMode: state.lightingMode,
    hiddenRoutes: state.hiddenRoutes,
  });
});
