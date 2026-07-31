import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { VehicleType } from "../types";

/**
 * Stylized rolling stock, one spec per vehicle type (F3.1's GLTF models come
 * later). Dimensions are deliberately approximate — they are chosen so the
 * four fleets read as different at a glance, not to match a spec sheet.
 */
export interface ConsistSpec {
  cars: number;
  carLengthM: number;
  gapM: number;
  widthM: number;
  heightM: number;
  /** Clearance between deck (vehicle z) and car underside. */
  rideHeightM: number;
  cabLengthM: number;
}

export const CONSISTS: Record<VehicleType, ConsistSpec> = {
  // MVP 3's train, unchanged: 4*15.8 + 3*0.6 = 65.0 m.
  heavy: { cars: 4, carLengthM: 15.8, gapM: 0.6, widthM: 3.2, heightM: 3.8, rideHeightM: 0.4, cabLengthM: 3.2 },
  // Pink/Yellow straddle monorail: narrower, shorter cars, sits on the beam.
  monorail: { cars: 4, carLengthM: 11.8, gapM: 0.5, widthM: 3.0, heightM: 3.6, rideHeightM: 0.2, cabLengthM: 2.6 },
  // Gold Line APM: 3-car people mover, the shortest thing on the network.
  apm: { cars: 3, carLengthM: 12.6, gapM: 0.5, widthM: 2.8, heightM: 3.4, rideHeightM: 0.2, cabLengthM: 2.4 },
  // SRT Red commuter EMU: longest cars.
  commuter: { cars: 4, carLengthM: 20, gapM: 0.8, widthM: 3.1, heightM: 4.0, rideHeightM: 0.5, cabLengthM: 3.6 },
};

/** Shared rolling-stock livery — placeholder until per-line models land. */
const BODY_COLOR = 0xdfe3e7;

export function consistLengthM(spec: ConsistSpec): number {
  return spec.cars * spec.carLengthM + (spec.cars - 1) * spec.gapM;
}

/** Paint a non-indexed-or-indexed geometry with a single vertex color. */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One merged, vertex-coloured train geometry; `accentHex` paints the cab cap. */
export function buildTrainGeometry(spec: ConsistSpec, accentHex: number): THREE.BufferGeometry {
  const bodyColor = new THREE.Color(BODY_COLOR);
  const cabColor = new THREE.Color(accentHex);
  const zCenter = spec.rideHeightM + spec.heightM / 2;
  const totalLength = consistLengthM(spec);

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spec.cars; i++) {
    const x = -totalLength / 2 + spec.carLengthM / 2 + i * (spec.carLengthM + spec.gapM);
    const car = new THREE.BoxGeometry(spec.carLengthM, spec.widthM, spec.heightM);
    car.translate(x, 0, zCenter);
    parts.push(paint(car, bodyColor));
  }
  // Cab cap: slightly oversized cross-section wrapping the +x nose.
  const cab = new THREE.BoxGeometry(spec.cabLengthM, spec.widthM + 0.2, spec.heightM + 0.15);
  cab.translate(totalLength / 2 - spec.cabLengthM / 2 + 0.4, 0, zCenter + 0.05);
  parts.push(paint(cab, cabColor));

  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}
