import { useEffect, useRef } from "react";
// maplibre-gl v6 ships named exports only — there is no default export.
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// v6 locates its tile worker with `new URL(\`./${name}\`, import.meta.url)` —
// a dynamic specifier no bundler can rewrite, so after bundling it points at a
// nonexistent /assets/maplibre-gl-worker.mjs and every vector-tile source
// silently stalls (blank base map). Hand it a URL Vite actually emits; the
// `?worker&url` suffix bundles the worker together with its shared chunk.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { NetworkLayer } from "../map/ThreeLayer";
import { installCameraControls } from "../map/cameraControls";
import { FollowCamera } from "../map/followCamera";
import { pickAt } from "../map/selection";
import { NightPainter } from "../map/dayNight";
import { activeMap } from "../map/activeMap";
import { BuildingLayers } from "../map/buildings";
import { UserLocation } from "../map/geolocation";
import { isNightAt, solarPosition } from "../map/sunPosition";
import { bangkokDayStartMs } from "../sim/time";
import { VehicleManager } from "../map/VehicleManager";
import { localToLngLat, ORIGIN_LNG_LAT } from "../map/coordinates";
import { SimClient, activeSimClient } from "../sim/SimClient";
import { useAppStore } from "../stores/useAppStore";
import network from "../data/network.json";
import type { NetworkData } from "../types";

setWorkerUrl(maplibreWorkerUrl);

export function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const setMapReady = useAppStore((s) => s.setMapReady);

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: ORIGIN_LNG_LAT,
      zoom: 12.5,
      pitch: 55,
      bearing: -15,
      maxPitch: 80,
      // Default is 3px; ordinary mouse clicks routinely move a few px between
      // pointerdown/up, which MapLibre's dragPan handler then reclassifies as
      // a pan (firing dragstart instead of click). Combined with onDragStart
      // below (which drops `following` on any real pan), that made the very
      // next click after starting to follow a train cancel it — "follow only
      // works once." A few extra px absorbs normal click jitter without
      // affecting genuine drag gestures.
      clickTolerance: 6,
      // v5+ moved GL context flags out of MapOptions into this bag.
      canvasContextAttributes: { antialias: true },
      attributionControl: {
        customAttribution:
          "Track © OpenStreetMap contributors (ODbL) · Stations: Namtang / OTP open data (CC-BY 4.0)",
      },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    // Published for the guided tour, which flies the camera to whatever each
    // step is describing. Cleared in the teardown below.
    activeMap.current = map;
    const removeCameraControls = installCameraControls(map);

    let sim: SimClient | null = null;
    let unsubscribeVisibility: (() => void) | null = null;
    let rafId = 0;
    let lightingTimer = 0;
    // style.load fires asynchronously; if effect cleanup runs first (a React
    // StrictMode double-invoke, or a fast unmount before tiles finish
    // loading), sim/unsubscribeVisibility/rafId below are created after
    // cleanup already ran with them still null, so nothing would ever tear
    // them down. Guarded at the end of the style.load handler.
    let disposed = false;
    const follow = new FollowCamera();
    const nightPainter = new NightPainter();
    const buildingLayers = new BuildingLayers();
    const userLocation = new UserLocation((status) =>
      useAppStore.getState().setLocationStatus(status),
    );
    // Latest interpolated poses, kept for click hit-testing. Owned by the
    // render path — never copied into React state (§3A.7).
    let lastVehicles: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let lastCount = 0;

    map.on("style.load", () => {
      const store = useAppStore.getState();
      const net = network as unknown as NetworkData;
      const vehicleManager = new VehicleManager(
        net.lines.map((l) => ({ color: l.color, vehicleType: l.vehicleType })),
      );
      const layer = new NetworkLayer(net, vehicleManager);
      map.addLayer(layer);
      setMapReady(true);
      store.setRoutes(net.lines);
      // Seed the layer/vehicle-manager visibility from whatever hiddenRoutes
      // already holds at mount time — on a cold load this is always [], but
      // the subscription below only reacts to *changes*, so without this a
      // remount with pre-existing hidden routes (future persistence, or a
      // React StrictMode double-invoke in dev) would render every line
      // visible until the next toggle.
      {
        const initial = useAppStore.getState();
        for (let i = 0; i < net.lines.length; i++) {
          const visible = initial.isRouteVisible(i);
          layer.setLineVisible(i, visible);
          vehicleManager.setRouteVisible(i, visible);
        }
      }
      // Scene modes are UI state too — seed them, then keep them in sync the
      // same way, off the per-frame path.
      {
        const initial = useAppStore.getState();
        layer.setUndergroundVisible(initial.undergroundVisible);
        layer.setLanguage(initial.language);
        layer.setStationLabelsVisible(initial.showStationLabels);
        layer.setShadows(initial.shadows);
        buildingLayers.setVisible(map, initial.buildings);
      }

      // The locate button lives in the UI but the tracker needs the map, so
      // the component owns the instance and lends the store a handler.
      useAppStore.getState().setLocationHandler(() => {
        if (userLocation.isTracking) userLocation.stop();
        else userLocation.start(map);
      });

      /**
       * Re-evaluate the sun for the current sim time (F3.3). Called on a slow
       * tick and on any lighting-mode change — never per frame: the sun moves
       * 0.004° per real second, and even at 60× warp a 1 Hz update is four
       * times finer than anything visible.
       *
       * Under `auto` the day/night decision comes from the sun's altitude, so
       * the base-map repaint and the 3D lighting flip at the same instant
       * (civil twilight) instead of drifting apart.
       */
      const applyLighting = () => {
        const state = useAppStore.getState();
        const simNow = activeSimClient.current?.getSimNow() ?? Date.now();
        const sun =
          state.lightingMode === "auto"
            ? solarPosition(simNow)
            : // Pinned modes still need a plausible sun direction, so borrow
              // mid-morning and late-evening geometry for the same day rather
              // than inventing an angle.
              solarPosition(bangkokDayStartMs(simNow) + (state.lightingMode === "day" ? 10 : 22) * 3_600_000);
        layer.setSun(sun);
        const night = state.lightingMode === "auto" ? isNightAt(sun.altitudeDeg) : state.lightingMode === "night";
        if (night !== state.night) state.setNight(night);
        nightPainter.apply(map, night);
      };
      applyLighting();
      lightingTimer = window.setInterval(applyLighting, 1000);

      // Visibility is UI state, so it drives the scene through a subscription
      // rather than the per-frame path.
      unsubscribeVisibility = useAppStore.subscribe((state, prev) => {
        let touchedScene = false;
        if (state.hiddenRoutes !== prev.hiddenRoutes) {
          for (let i = 0; i < net.lines.length; i++) {
            const visible = state.isRouteVisible(i);
            layer.setLineVisible(i, visible);
            vehicleManager.setRouteVisible(i, visible);
          }
          touchedScene = true;
        }
        if (state.undergroundVisible !== prev.undergroundVisible) {
          layer.setUndergroundVisible(state.undergroundVisible);
          touchedScene = true;
        }
        if (state.showStationLabels !== prev.showStationLabels) {
          layer.setStationLabelsVisible(state.showStationLabels);
          touchedScene = true;
        }
        if (state.shadows !== prev.shadows) {
          layer.setShadows(state.shadows);
          touchedScene = true;
        }
        if (state.buildings !== prev.buildings) {
          buildingLayers.setVisible(map, state.buildings);
          touchedScene = true;
        }
        if (state.language !== prev.language) {
          // Rebuilds every label texture — a user action, never per frame.
          layer.setLanguage(state.language);
          touchedScene = true;
        }
        if (state.lightingMode !== prev.lightingMode) {
          applyLighting();
          touchedScene = true;
        } else if (state.night !== prev.night) {
          // `night` moved on its own — the auto tick crossing twilight.
          touchedScene = true;
        }
        // The store fires on every state change (the clock, the vehicle count,
        // a selection); repaint only when one of these actually moved.
        if (touchedScene) map.triggerRepaint();
      });

      store.setEngineStatus("loading");
      let lastCountUpdate = 0;
      sim = new SimClient({
        onReady: (validation) => {
          const s = useAppStore.getState();
          s.setValidation(validation);
          s.setEngineStatus("ready");
          // Static station list, fetched once — powers click hit-testing and
          // the station board's indices (contract §7).
          void sim
            ?.getStations()
            .then((stations) => useAppStore.getState().setStations(stations))
            .catch(() => undefined);
        },
        onError: (message) => useAppStore.getState().setEngineStatus("error", message),
        onClock: (params) => useAppStore.getState().setClock(params),
        onFrame: (_simEpochMs, count) => {
          // 10 Hz worker frames -> 1 Hz UI updates (§3A.7).
          const now = performance.now();
          if (now - lastCountUpdate >= 1000) {
            lastCountUpdate = now;
            useAppStore.getState().setVehicleCount(count);
          }
        },
      });
      activeSimClient.current = sim;

      // Per-frame path: interpolate + pose instances inside the layer's
      // render(), entirely outside React.
      layer.beforeRender = () => {
        const client = activeSimClient.current;
        if (!client) return;
        const { vehicles, count } = client.getInterpolated(performance.now());
        const { selectedRunIdx, following } = useAppStore.getState();
        vehicleManager.update(vehicles, count, selectedRunIdx);
        // Read the follow target here (the buffer is already in hand) but move
        // the camera in the rAF loop — jumpTo() inside render() re-enters
        // MapLibre's render path.
        follow.capture(vehicles, count, following ? selectedRunIdx : null);
        lastVehicles = vehicles;
        lastCount = count;
      };

      // MapLibre only repaints on demand — keep frames coming while the
      // engine is running.
      const loop = () => {
        if (useAppStore.getState().engineStatus === "ready") {
          follow.apply(map);
          map.triggerRepaint();
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);

      if (disposed) {
        // Cleanup already ran before this fired — tear down what it missed
        // instead of leaking a running rAF loop, worker and subscription.
        cancelAnimationFrame(rafId);
        clearInterval(lightingTimer);
        unsubscribeVisibility?.();
        sim?.dispose();
        if (activeSimClient.current === sim) activeSimClient.current = null;
      }
    });

    // Click to select a train or station. Uses the most recent interpolated
    // buffer — the same poses that are on screen.
    const onMapClick = (e: { point: { x: number; y: number } }) => {
      const { stations, selectRun, selectStation, hiddenRoutes } = useAppStore.getState();
      const hit = pickAt(map, lastVehicles, lastCount, stations, e.point, hiddenRoutes);
      if (!hit) {
        // Clicking empty map clears the selection, like clicking away from
        // anything else.
        selectRun(null);
        selectStation(null);
        return;
      }
      if (hit.type === "vehicle") {
        selectRun(hit.runIdx);
      } else {
        selectStation({ routeIdx: hit.routeIdx, stationIdx: hit.stationIdx });
      }
    };
    map.on("click", onMapClick);

    // Panning while following would fight the per-frame jumpTo, so the first
    // user drag hands control back (Mini Tokyo 3D does the same).
    const onDragStart = () => {
      if (useAppStore.getState().following) useAppStore.getState().setFollowing(false);
    };
    map.on("dragstart", onDragStart);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const store = useAppStore.getState();
      store.selectRun(null);
      store.selectStation(null);
    };
    window.addEventListener("keydown", onKeyDown);

    // Releasing follow must also clear the smoothed bearing, or the next
    // follow starts from a stale heading. Switching the followed train while
    // still following (clicking train B while locked onto train A —
    // selectRun() intentionally preserves `following`) needs the same
    // treatment for bearing alone: the pose snaps instantly via capture(),
    // but bearing eases, so leaving it set carries A's heading into B's shot.
    const unsubscribeFollow = useAppStore.subscribe((state, prev) => {
      if (prev.following && !state.following) {
        follow.reset();
      } else if (state.following && state.selectedRunIdx !== prev.selectedRunIdx) {
        follow.resetBearing();
      }
    });

    // Dev builds always expose these; a production build (tools/verify-perf.mjs
    // runs against `npm run preview`, i.e. a real prod bundle — dev-mode React
    // and unminified Three would make the NF1 numbers meaningless) exposes them
    // too, but only when opted in via `?debug=1`, so ordinary production
    // visitors never get debug globals on `window`.
    const debugRequested =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
    if (import.meta.env.DEV || debugRequested) {
      // dev/debug-only handles for tools/screenshot.mjs and tools/verify-*.mjs
      const dev = window as unknown as {
        __map?: MapLibreMap;
        __sim?: typeof activeSimClient;
        __store?: typeof useAppStore;
        __localToLngLat?: typeof localToLngLat;
      };
      dev.__map = map;
      dev.__sim = activeSimClient;
      // verify-mvp4.mjs needs these to drive selection and to convert engine
      // ENU positions into screen pixels for a real click.
      dev.__store = useAppStore;
      dev.__localToLngLat = localToLngLat;
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearInterval(lightingTimer);
      // Stop the GPS watch explicitly: a live `watchPosition` keeps the
      // device's location hardware awake long after the component is gone.
      activeMap.current = null;
      userLocation.dispose();
      useAppStore.getState().setLocationHandler(null);
      removeCameraControls();
      unsubscribeFollow();
      unsubscribeVisibility?.();
      map.off("click", onMapClick);
      map.off("dragstart", onDragStart);
      window.removeEventListener("keydown", onKeyDown);
      activeSimClient.current = null;
      sim?.dispose();
      map.remove();
      const store = useAppStore.getState();
      store.setEngineStatus("off");
      store.setValidation(null);
      store.setVehicleCount(0);
      store.selectRun(null);
      store.selectStation(null);
      store.setStations([]);
      setMapReady(false);
    };
  }, [setMapReady]);

  // NB: MapLibre's stylesheet forces `.maplibregl-map { position: relative }`,
  // so size with h-full/w-full rather than absolute inset positioning.
  return <div ref={containerRef} className="h-full w-full" />;
}
