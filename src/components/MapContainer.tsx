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
import { VehicleManager } from "../map/VehicleManager";
import { ORIGIN_LNG_LAT } from "../map/coordinates";
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
        vehicleManager.update(vehicles, count);
      };

      // MapLibre only repaints on demand — keep frames coming while the
      // engine is running.
      const loop = () => {
        if (useAppStore.getState().engineStatus === "ready") map.triggerRepaint();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    });

    if (import.meta.env.DEV) {
      // dev-only handles for tools/screenshot.mjs and tools/verify-*.mjs
      (window as unknown as { __map?: MapLibreMap }).__map = map;
      (window as unknown as { __sim?: typeof activeSimClient }).__sim = activeSimClient;
    }
    return () => {
      cancelAnimationFrame(rafId);
      removeCameraControls();
      activeSimClient.current = null;
      sim?.dispose();
      map.remove();
      const store = useAppStore.getState();
      store.setEngineStatus("off");
      store.setValidation(null);
      store.setVehicleCount(0);
      setMapReady(false);
    };
  }, [setMapReady]);

  // NB: MapLibre's stylesheet forces `.maplibregl-map { position: relative }`,
  // so size with h-full/w-full rather than absolute inset positioning.
  return <div ref={containerRef} className="h-full w-full" />;
}
