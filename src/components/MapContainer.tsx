import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GreenLineLayer } from "../map/ThreeLayer";
import { VehicleManager } from "../map/VehicleManager";
import { ORIGIN_LNG_LAT } from "../map/coordinates";
import { SimClient, activeSimClient } from "../sim/SimClient";
import { useAppStore } from "../stores/useAppStore";
import greenLine from "../data/green-line.json";
import type { GreenLineData } from "../types";

export function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const setMapReady = useAppStore((s) => s.setMapReady);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: ORIGIN_LNG_LAT,
      zoom: 12.5,
      pitch: 55,
      bearing: -15,
      maxPitch: 80,
      antialias: true,
      attributionControl: {
        customAttribution:
          "Track © OpenStreetMap contributors (ODbL) · Stations: Namtang / OTP open data (CC-BY 4.0)",
      },
    });
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

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
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
      (window as unknown as { __sim?: typeof activeSimClient }).__sim = activeSimClient;
    }
    return () => {
      cancelAnimationFrame(rafId);
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
