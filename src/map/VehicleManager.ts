import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  LANE_ROUTE_IDX,
  LANE_RUN_IDX,
  LANE_X,
  LANE_Y,
  LANE_YAW,
  LANE_Z,
  MAX_VEHICLES,
  VEHICLE_STRIDE,
} from "../sim/protocol";

/**
 * Instanced train rendering (ENGINE_CONTRACT.md §6): one InstancedMesh per
 * route (capacity MAX_VEHICLES) — two draw calls for the whole fleet.
 *
 * The train is a stylized 4-car consist (~65 m x 3.2 m x 3.8 m overall) in
 * white-grayish livery, with a route-colored cab cap on the +x end so both
 * the direction of travel and the route stay readable. Car bodies + cab are
 * merged into ONE vertex-colored geometry per route. The long axis is +x at
 * yaw = 0; yaw rotates around +z (up) in the local ENU frame, matching the
 * sim's vehicle records.
 */

/** Shared rolling-stock livery — placeholder until per-line models land. */
const BODY_COLOR = 0xdfe3e7;
/** Cab-cap accent, index == route_idx: [0]=Sukhumvit, [1]=Silom (contract §2). */
const ROUTE_COLORS = [0x65b724, 0x246b5b];

const CAR_LENGTH_M = 15.8;
const CAR_GAP_M = 0.6;
const CARS = 4; // total length 4*15.8 + 3*0.6 = 65.0 m
const BODY_WIDTH_M = 3.2;
const BODY_HEIGHT_M = 3.8;
/** Clearance between deck (vehicle z) and car underside. */
const RIDE_HEIGHT_M = 0.4;
const CAB_LENGTH_M = 3.2;

/** Paint a non-indexed-or-indexed geometry with a single vertex color. */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One merged, vertex-colored train geometry; `accentHex` paints the cab cap. */
function buildTrainGeometry(accentHex: number): THREE.BufferGeometry {
  const bodyColor = new THREE.Color(BODY_COLOR);
  const cabColor = new THREE.Color(accentHex);
  const zCenter = RIDE_HEIGHT_M + BODY_HEIGHT_M / 2;
  const totalLength = CARS * CAR_LENGTH_M + (CARS - 1) * CAR_GAP_M;

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < CARS; i++) {
    const x = -totalLength / 2 + CAR_LENGTH_M / 2 + i * (CAR_LENGTH_M + CAR_GAP_M);
    const car = new THREE.BoxGeometry(CAR_LENGTH_M, BODY_WIDTH_M, BODY_HEIGHT_M);
    car.translate(x, 0, zCenter);
    parts.push(paint(car, bodyColor));
  }
  // Cab cap: slightly oversized cross-section wrapping the +x nose.
  const cab = new THREE.BoxGeometry(CAB_LENGTH_M, BODY_WIDTH_M + 0.2, BODY_HEIGHT_M + 0.15);
  cab.translate(totalLength / 2 - CAB_LENGTH_M / 2 + 0.4, 0, zCenter + 0.05);
  parts.push(paint(cab, cabColor));

  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Per-instance tint multiplied over the vertex colors (MVP 4 selection). */
const TINT_PLAIN = new THREE.Color(1, 1, 1);
const TINT_SELECTED = new THREE.Color(1.9, 1.55, 0.5);

export class VehicleManager {
  /** One InstancedMesh per route, index == route_idx. Add these to the scene. */
  readonly meshes: THREE.InstancedMesh[];

  private matrix = new THREE.Matrix4();
  /** Selection at the last colour write, to skip redundant attribute uploads. */
  private tintedFor: number | null = null;

  constructor() {
    this.meshes = ROUTE_COLORS.map((color, routeIdx) => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(buildTrainGeometry(color), material, MAX_VEHICLES);
      mesh.name = `vehicles-route-${routeIdx}`;
      mesh.count = 0;
      // The custom-layer projection matrix defeats Three's frustum test.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
  }

  /**
   * Set instance matrices from interpolated stride-8 vehicle records
   * (protocol.ts lanes). Called from the render loop — no allocations.
   *
   * `selectedRunIdx` tints one instance so the picked train is findable in a
   * crowd; instance order changes every frame, so the tint is written per
   * frame rather than tracked.
   */
  update(vehicles: Float32Array, count: number, selectedRunIdx: number | null = null): void {
    // Instance order changes every frame, so tints must be rewritten whenever
    // anything IS selected. With no selection they are all plain and the
    // 512×3 attribute upload can be skipped entirely.
    const selectionChanged = selectedRunIdx !== this.tintedFor;
    const writeTints = selectedRunIdx !== null || selectionChanged;
    this.tintedFor = selectedRunIdx;

    const counts = [0, 0];
    for (let i = 0; i < count; i++) {
      const o = i * VEHICLE_STRIDE;
      const routeIdx = vehicles[o + LANE_ROUTE_IDX] | 0;
      const mesh = this.meshes[routeIdx];
      if (!mesh || counts[routeIdx] >= MAX_VEHICLES) continue;
      this.matrix
        .makeRotationZ(vehicles[o + LANE_YAW])
        .setPosition(vehicles[o + LANE_X], vehicles[o + LANE_Y], vehicles[o + LANE_Z]);
      const slot = counts[routeIdx]++;
      mesh.setMatrixAt(slot, this.matrix);
      if (writeTints) {
        mesh.setColorAt(
          slot,
          vehicles[o + LANE_RUN_IDX] === selectedRunIdx ? TINT_SELECTED : TINT_PLAIN,
        );
      }
    }
    for (let r = 0; r < this.meshes.length; r++) {
      const mesh = this.meshes[r];
      mesh.count = counts[r];
      mesh.instanceMatrix.needsUpdate = true;
      // Allocated lazily by the first setColorAt; absent if no vehicle drew.
      if (writeTints && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
