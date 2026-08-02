/**
 * The one glass treatment every floating panel uses (MVP 6's glassmorphism
 * pass).
 *
 * A shared constant rather than the same class list copy-pasted into five
 * components: they sit on the same map, at the same depth, and the moment two
 * of them drift apart — a slightly different white, a different blur — the
 * whole surface stops reading as one material.
 *
 * The recipe, and why each part earns its place over a plain translucent fill:
 * - `backdrop-blur-xl` + `backdrop-saturate-150` — the blur is what makes it
 *   glass rather than a tint, and the saturation boost stops the map behind it
 *   turning grey and muddy where it shows through.
 * - `bg-white/70` — low enough to read as translucent over the city, high
 *   enough that small text stays legible over a dark night map.
 * - `ring-1 ring-white/70` — a bright hairline edge. Without it a blurred
 *   panel has no boundary at all against a pale basemap and appears to smear.
 * - `shadow-xl` — lifts the panel off the map so the blur reads as depth.
 */
export const GLASS =
  "bg-white/70 shadow-xl ring-1 ring-white/70 backdrop-blur-xl backdrop-saturate-150";

/** Divider inside a glass panel — solid slate would look painted on. */
export const GLASS_DIVIDER = "border-slate-900/10";
