import type { Structure } from "../types";

/**
 * Nominal deck heights per structure type (SRS §F1.3: underground −12..−25,
 * at-grade +0.5, elevated +12..+22). One number per band — real per-segment
 * depth would need OSM `layer` arithmetic no Bangkok relation reliably carries.
 *
 * Mirrored in tools/lines.config.mjs (the fetcher runs in plain node and
 * cannot import TS). Keep the two in sync; structure.test.ts asserts the
 * SRS bands on this copy and lines.config.test.mjs asserts them on that one.
 */
export const STRUCTURE_ALTITUDE_M: Record<Structure, number> = {
  elevated: 15,
  atGrade: 0.5,
  underground: -18,
};

/** OSM way tags relevant to vertical structure. */
export interface WayTags {
  tunnel?: string;
  bridge?: string;
  layer?: string;
}

/**
 * Classify one OSM way as underground / elevated / at-grade.
 *
 * Precedence is deliberate: an explicit `tunnel`/`bridge` tag beats `layer`,
 * because Bangkok relations frequently carry a station-box `layer=-1` on ways
 * that are physically at grade. `tunnel=no` is a real tag and must not be read
 * as truthy.
 */
export function structureOfWay(tags: WayTags, fallback: Structure = "elevated"): Structure {
  const tunnel = tags.tunnel;
  if (tunnel && tunnel !== "no") return "underground";
  const bridge = tags.bridge;
  if (bridge && bridge !== "no") return "elevated";
  if (tunnel === "no" || bridge === "no") return "elevated";
  const layer = Number.parseInt(tags.layer ?? "", 10);
  if (Number.isFinite(layer) && layer < 0) return "underground";
  if (Number.isFinite(layer) && layer > 0) return "elevated";
  return fallback;
}
