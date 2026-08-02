import * as THREE from "three";
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
import { buildTrainGeometry, consistLengthM, CONSISTS } from "./vehicleModels";
import type { VehicleType } from "../types";

/**
 * Instanced train rendering (ENGINE_CONTRACT.md §6): one InstancedMesh per
 * route (capacity MAX_VEHICLES) — one draw call per route for the whole
 * fleet.
 *
 * Train geometry is built per vehicle type from `vehicleModels.ts`'s
 * ConsistSpecs — a stylized multi-car consist in white-grayish livery, with
 * a route-colored cab cap on the +x end so both the direction of travel and
 * the route stay readable. Car bodies + cab are merged into ONE
 * vertex-colored geometry per route. The long axis is +x at yaw = 0; yaw
 * rotates around +z (up) in the local ENU frame, matching the sim's vehicle
 * records.
 */

export interface VehicleRoute {
  color: string;
  vehicleType: VehicleType;
}

/** Per-instance tint multiplied over the vertex colors (MVP 4 selection). */
const TINT_PLAIN = new THREE.Color(1, 1, 1);
const TINT_SELECTED = new THREE.Color(1.9, 1.55, 0.5);

/** Beyond this camera distance the mesh is a hairline; draw dots instead. */
const MARKER_FROM_M = 7_000;
/** Dot radius as a fraction of camera distance — constant size on screen. */
const MARKER_ANGULAR_RADIUS = 0.0042;
const MARKER_MIN_RADIUS_M = 25;
const MARKER_MAX_RADIUS_M = 400;
/** Height above the track, so a dot is not buried in the deck it rides on. */
const MARKER_LIFT_M = 40;

const WORLD_UP = new THREE.Vector3(0, 0, 1);

export class VehicleManager {
  /** One InstancedMesh per route, index == route_idx. Add these to the scene. */
  readonly meshes: THREE.InstancedMesh[];
  /**
   * One shared InstancedMesh of camera-facing dots for the far view, coloured
   * per instance. One mesh rather than one per route because it is a single
   * draw call for the whole fleet and the colour is per instance anyway.
   */
  readonly markers: THREE.InstancedMesh;

  private matrix = new THREE.Matrix4();
  private scaleVector = new THREE.Vector3(1, 1, 1);
  /** Uniform enlargement applied to every train — see `setViewScale`. */
  private viewScale = 1;
  /** Consist length per route, for turning a screen minimum into a scale. */
  private lengthByRoute: number[];
  /** Line colour per route, for the far-view dots. */
  private colorByRoute: THREE.Color[];
  private markersActive = false;
  private markerRadiusM = MARKER_MIN_RADIUS_M;
  private cameraPosition = new THREE.Vector3();
  private markerMatrix = new THREE.Matrix4();
  private markerBasis = new THREE.Matrix4();
  private toCamera = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private markerScale = new THREE.Vector3();
  /** Selection at the last colour write, to skip redundant attribute uploads. */
  private tintedFor: number | null = null;
  /** Reused per frame — sized to the route count, never reallocated. */
  private counts: number[];

  constructor(routes: VehicleRoute[]) {
    this.counts = new Array(routes.length).fill(0);
    this.lengthByRoute = routes.map((route) => consistLengthM(CONSISTS[route.vehicleType]));
    this.meshes = routes.map((route, routeIdx) => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const geometry = buildTrainGeometry(
        CONSISTS[route.vehicleType],
        new THREE.Color(route.color).getHex(),
      );
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_VEHICLES);
      mesh.name = `vehicles-route-${routeIdx}`;
      mesh.count = 0;
      // The custom-layer projection matrix defeats Three's frustum test.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
    this.colorByRoute = routes.map((route) => new THREE.Color(route.color));

    // Unit-radius disc, scaled per instance. `MeshBasicMaterial` because a dot
    // is a map symbol, not part of the scene — shading it would make trains
    // hard to find at night, which is when the map is darkest.
    const markerGeometry = new THREE.CircleGeometry(1, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false,
      toneMapped: false,
      // Drawn over the track and the city: the whole point is "there is a
      // train here", which is useless if a building can hide it.
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    this.markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, MAX_VEHICLES);
    this.markers.name = "vehicle-markers";
    this.markers.count = 0;
    this.markers.visible = false;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 9;
    this.markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * Keep trains findable as the camera pulls back, in two stages.
   *
   * **Close in**, trains are drawn at true size — a 65 m consist looks like a
   * 65 m consist, which is the point of a 3D map.
   *
   * **Middle distance**, they are enlarged so the shortest consist still spans
   * a usable number of pixels. Capped, so a train never becomes a slab that
   * hides the line it is running on.
   *
   * **Far out**, enlarging stops working at all, and this is the part that is
   * easy to get wrong. A train scaled to stay visible lengthwise is still only
   * a metre or two wide, so it renders as a hairline lying exactly along the
   * track — indistinguishable from the track itself. Past `MARKER_FROM_M` the
   * manager therefore switches to drawing a **dot per train** in the line's
   * colour, sized by angle so it holds a constant size on screen. That is what
   * makes "where are the trains right now?" answerable from the whole-region
   * view, which is the view the app opens at.
   *
   * @param cameraDistanceM metres from the viewer to the ground being viewed.
   */
  setViewScale(cameraDistanceM: number): void {
    // A train should occupy at least this fraction of the camera distance,
    // which is a constant angular size and therefore a constant screen size.
    const MIN_ANGULAR_LENGTH = 0.02;
    const MAX_ENLARGEMENT = 6;

    const shortest = Math.min(...this.lengthByRoute);
    const wanted = cameraDistanceM * MIN_ANGULAR_LENGTH;
    this.viewScale = Math.min(MAX_ENLARGEMENT, Math.max(1, wanted / shortest));

    this.markersActive = cameraDistanceM > MARKER_FROM_M;
    // Angular sizing, exactly as the station labels do it: the dot stays the
    // same size on screen whether you are 8 km up or 60.
    this.markerRadiusM = Math.min(
      MARKER_MAX_RADIUS_M,
      Math.max(MARKER_MIN_RADIUS_M, cameraDistanceM * MARKER_ANGULAR_RADIUS),
    );
  }

  /**
   * The camera's position in the local frame, for billboarding the dots.
   *
   * They must face the viewer: a flat disc lying on the ground vanishes to a
   * line the moment the map is tilted, which is most of the time here.
   */
  setCameraPosition(position: THREE.Vector3): void {
    this.cameraPosition.copy(position);
  }

  /** Whether the far-view dots are currently being drawn. */
  get markersVisible(): boolean {
    return this.markersActive;
  }

  /** Current enlargement, for tests and diagnostics. */
  get scale(): number {
    return this.viewScale;
  }

  /** Hide one route's fleet without disturbing the others' instance packing. */
  setRouteVisible(routeIdx: number, visible: boolean): void {
    const mesh = this.meshes[routeIdx];
    if (mesh) mesh.visible = visible;
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
    // 1024×3 attribute upload can be skipped entirely.
    const selectionChanged = selectedRunIdx !== this.tintedFor;
    const writeTints = selectedRunIdx !== null || selectionChanged;
    this.tintedFor = selectedRunIdx;

    const counts = this.counts;
    counts.fill(0);
    let markerSlot = 0;

    for (let i = 0; i < count; i++) {
      const o = i * VEHICLE_STRIDE;
      const routeIdx = vehicles[o + LANE_ROUTE_IDX] | 0;
      const mesh = this.meshes[routeIdx];
      if (!mesh || counts[routeIdx] >= MAX_VEHICLES) continue;

      // Far view: a dot per train, facing the camera, in the line's colour.
      // Hidden routes are skipped so the filter means the same thing at every
      // zoom — the dots are the trains, not a separate overlay.
      if (this.markersActive && mesh.visible && markerSlot < MAX_VEHICLES) {
        this.markerScale.setScalar(this.markerRadiusM);
        this.toCamera
          .set(
            this.cameraPosition.x - vehicles[o + LANE_X],
            this.cameraPosition.y - vehicles[o + LANE_Y],
            this.cameraPosition.z - vehicles[o + LANE_Z],
          )
          .normalize();
        this.right.crossVectors(WORLD_UP, this.toCamera);
        if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
        this.right.normalize();
        this.up.crossVectors(this.toCamera, this.right);
        this.markerBasis.makeBasis(this.right, this.up, this.toCamera);
        this.markerMatrix
          .copy(this.markerBasis)
          .scale(this.markerScale)
          .setPosition(
            vehicles[o + LANE_X],
            vehicles[o + LANE_Y],
            vehicles[o + LANE_Z] + MARKER_LIFT_M,
          );
        this.markers.setMatrixAt(markerSlot, this.markerMatrix);
        this.markers.setColorAt(
          markerSlot,
          vehicles[o + LANE_RUN_IDX] === selectedRunIdx
            ? TINT_SELECTED
            : this.colorByRoute[routeIdx],
        );
        markerSlot++;
      }

      this.scaleVector.setScalar(this.viewScale);
      this.matrix
        .makeRotationZ(vehicles[o + LANE_YAW])
        .scale(this.scaleVector)
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

    this.markers.visible = this.markersActive && markerSlot > 0;
    this.markers.count = markerSlot;
    if (this.markers.visible) {
      this.markers.instanceMatrix.needsUpdate = true;
      if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    }
  }
}
