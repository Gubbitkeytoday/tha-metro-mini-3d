import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Night mode for the *base map* (MVP 6 polish). The Three layer's own lighting
 * is retuned separately by `NetworkLayer.setNight()`.
 *
 * Why repaint the style rather than drop a dark overlay over the canvas: the
 * base map and the 3D track share one WebGL canvas, so any DOM overlay dark
 * enough to read as night would dim the track and trains by exactly as much —
 * which is the opposite of what night mode is for. Walking the style's own
 * paint colours darkens the city and leaves the network at full contrast.
 *
 * OpenFreeMap's Liberty style has no dark sibling to switch to, and swapping
 * `setStyle()` would tear down the custom layer (and with it the Three scene,
 * the vehicle meshes and the sim's render hook) on every toggle.
 */

/**
 * MapLibre types get/setPaintProperty against a union of every known paint
 * property name. This table is keyed by layer type, so the property is only
 * valid for the layers it is paired with and no single literal type covers
 * them all — the pairing is enforced by COLOR_PROPS below, not by the
 * signature. Narrow at the call site instead of widening the table.
 */
type PaintProp = Parameters<MapLibreMap["getPaintProperty"]>[1];

/** Paint properties worth darkening, per layer type. */
const COLOR_PROPS: Record<string, string[]> = {
  background: ["background-color"],
  fill: ["fill-color", "fill-outline-color"],
  line: ["line-color"],
  "fill-extrusion": ["fill-extrusion-color"],
  symbol: ["text-color", "text-halo-color", "icon-color"],
};

/** How far each layer type moves toward the night tint (0 = unchanged). */
const MIX: Record<string, number> = {
  background: 0.82,
  fill: 0.78,
  line: 0.72,
  "fill-extrusion": 0.7,
  // Labels stay far more legible than the surfaces behind them.
  symbol: 0.35,
};

const NIGHT_TINT: [number, number, number] = [12, 18, 38];

/** The paint value as MapLibre handed it back, replayed verbatim on restore. */
type PaintValue = Parameters<MapLibreMap["setPaintProperty"]>[2];

type Saved = { layerId: string; prop: PaintProp; value: PaintValue };

/** Parses the CSS colour forms MapLibre styles actually use: #rgb, #rrggbb,
 *  rgb()/rgba(), and hsl()/hsla(). Anything else (a named colour, a data
 *  expression) returns null and is left alone rather than guessed at. */
export function parseColor(value: unknown): [number, number, number, number] | null {
  if (typeof value !== "string") return null;
  const s = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      1,
    ];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseFloat(p));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1];
  }

  const hsl = /^hsla?\(([^)]+)\)$/i.exec(s);
  if (hsl) {
    const parts = hsl[1].split(",").map((p) => parseFloat(p));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    const [h, sPct, lPct] = parts;
    const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    const sat = sPct / 100;
    const lig = lPct / 100;
    const c = (1 - Math.abs(2 * lig - 1)) * sat;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] =
      hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
      : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = lig - c / 2;
    return [
      Math.round((r1 + m) * 255),
      Math.round((g1 + m) * 255),
      Math.round((b1 + m) * 255),
      a,
    ];
  }

  return null;
}

/** Blend `value` toward the night tint by `amount`, preserving alpha. */
export function darken(value: unknown, amount: number): string | null {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const [r, g, b, a] = parsed;
  const mix = (channel: number, target: number) =>
    Math.round(channel + (target - channel) * amount);
  const out = [mix(r, NIGHT_TINT[0]), mix(g, NIGHT_TINT[1]), mix(b, NIGHT_TINT[2])];
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${a})`;
}

/**
 * Applies (or reverts) night colouring to every base-map layer.
 *
 * The original paint values are captured on the first `applyNight(map, true)`
 * and replayed verbatim on the way back, so toggling repeatedly can't compound
 * the darkening — re-darkening an already-darkened colour is the obvious way
 * this would rot.
 */
export class NightPainter {
  private saved: Saved[] | null = null;

  apply(map: MapLibreMap, night: boolean): void {
    if (night) {
      if (this.saved) return; // already applied
      const saved: Saved[] = [];
      for (const layer of map.getStyle().layers ?? []) {
        const props = COLOR_PROPS[layer.type];
        if (!props) continue;
        for (const prop of props as PaintProp[]) {
          let current: PaintValue;
          try {
            current = map.getPaintProperty(layer.id, prop);
          } catch {
            continue;
          }
          const next = darken(current, MIX[layer.type] ?? 0.7);
          if (next === null) continue;
          saved.push({ layerId: layer.id, prop, value: current });
          map.setPaintProperty(layer.id, prop, next);
        }
      }
      this.saved = saved;
      return;
    }

    if (!this.saved) return;
    for (const { layerId, prop, value } of this.saved) {
      try {
        map.setPaintProperty(layerId, prop, value);
      } catch {
        // Layer went away with a style change — nothing to restore.
      }
    }
    this.saved = null;
  }
}
