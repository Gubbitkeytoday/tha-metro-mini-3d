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
import { GreenLineLayer } from "../map/ThreeLayer";
import { installCameraControls } from "../map/cameraControls";
import { FollowCamera } from "../map/followCamera";
import { pickAt } from "../map/selection";
import { VehicleManager } from "../map/VehicleManager";
import { localToLngLat, ORIGIN_LNG_LAT } from "../map/coordinates";
import { SimClient, activeSimClient } from "../sim/SimClient";
import { useAppStore } from "../stores/useAppStore";
import greenLine from "../data/green-line.json";
import type { GreenLineData } from "../types";

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
    const removeCameraControls = installCameraControls(map);

    let sim: SimClient | null = null;
    let rafId = 0;
    const follow = new FollowCamera();
    // Latest interpolated poses, kept for click hit-testing. Owned by the
    // render path — never copied into React state (§3A.7).
    let lastVehicles: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let lastCount = 0;

    map.on("style.load", () => {
      const store = useAppStore.getState();
      const vehicleManager = new VehicleManager();
      const layer = new GreenLineLayer(greenLine as unknown as GreenLineData, vehicleManager);
      map.addLayer(layer);
      setMapReady(true);

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
    });

    // Click to select a train or station. Uses the most recent interpolated
    // buffer — the same poses that are on screen.
    const onMapClick = (e: { point: { x: number; y: number } }) => {
      const { stations, selectRun, selectStation } = useAppStore.getState();
      const hit = pickAt(map, lastVehicles, lastCount, stations, e.point);
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

    if (import.meta.env.DEV) {
      // dev-only handles for tools/screenshot.mjs and tools/verify-*.mjs
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
      cancelAnimationFrame(rafId);
      removeCameraControls();
      unsubscribeFollow();
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
