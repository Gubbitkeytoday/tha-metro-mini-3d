import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Show/hide the base map's 3D building extrusions.
 *
 * These come from the OpenFreeMap Liberty style, not from this app, so the
 * only handle on them is the style's own layer visibility. They are worth a
 * switch for two reasons: they occlude elevated track and trains from a low
 * camera angle (the whole point of which is to watch the trains), and they are
 * the most expensive thing the base map draws, so turning them off is the
 * single biggest win on a weak GPU.
 *
 * Layers are matched by TYPE (`fill-extrusion`), not by a hardcoded layer id:
 * style authors rename layers, and a style with no extrusions at all should
 * simply have nothing to toggle rather than throwing.
 */
export class BuildingLayers {
  private ids: string[] | null = null;

  /** Layer ids discovered in the current style; empty if the style has none. */
  private discover(map: MapLibreMap): string[] {
    if (this.ids) return this.ids;
    this.ids = (map.getStyle().layers ?? [])
      .filter((l) => l.type === "fill-extrusion")
      .map((l) => l.id);
    return this.ids;
  }

  setVisible(map: MapLibreMap, visible: boolean): void {
    for (const id of this.discover(map)) {
      try {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      } catch {
        // Layer vanished with a style change — nothing to toggle.
      }
    }
  }

  /** How many extrusion layers this style actually has (0 = nothing to hide). */
  count(map: MapLibreMap): number {
    return this.discover(map).length;
  }
}
