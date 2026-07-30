import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GreenLineLayer } from "../map/ThreeLayer";
import { ORIGIN_LNG_LAT } from "../map/coordinates";
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
    map.on("style.load", () => {
      map.addLayer(new GreenLineLayer(greenLine as unknown as GreenLineData));
      setMapReady(true);
    });
    if (import.meta.env.DEV) {
      // dev-only handle for tools/screenshot.mjs camera poses
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
    }
    return () => {
      map.remove();
      setMapReady(false);
    };
  }, [setMapReady]);

  // NB: MapLibre's stylesheet forces `.maplibregl-map { position: relative }`,
  // so size with h-full/w-full rather than absolute inset positioning.
  return <div ref={containerRef} className="h-full w-full" />;
}
