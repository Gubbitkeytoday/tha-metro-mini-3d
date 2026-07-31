import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import type { NetworkData } from "../types";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import { buildStationMarkers, buildTrackDeck, buildTrackLine } from "./trackGeometry";
import type { VehicleManager } from "./VehicleManager";

/**
 * Custom MapLibre layer hosting the Three.js scene (SRS §3A.4).
 *
 * Three renders into MapLibre's OWN WebGL context (never a second canvas).
 * Each frame MapLibre hands us a float64 mercator→clip matrix; we fold the
 * local-frame origin translation + meter scale into it before it ever
 * touches the GPU, so vertex data stays small (floating origin, §3A.5).
 */
export class NetworkLayer implements CustomLayerInterface {
  id = "network-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private camera = new THREE.Camera();
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  /** local ENU meters -> absolute mercator (float64, applied in JS). */
  private originMatrix = new THREE.Matrix4()
    .makeTranslation(ORIGIN_MERC.x, ORIGIN_MERC.y, 0)
    .scale(new THREE.Vector3(MERC_PER_METER, -MERC_PER_METER, MERC_PER_METER));
  private projection = new THREE.Matrix4();
  private lineMaterials: LineMaterial[] = [];
  /** Per-line groups, index == route_idx — the unit the line selector toggles. */
  private lineGroups: THREE.Group[] = [];

  /**
   * Per-frame hook, invoked at the start of every render() before drawing —
   * MapContainer uses it to push interpolated vehicle poses into the
   * VehicleManager without touching React/Zustand (SRS §3A.7).
   */
  beforeRender: (() => void) | null = null;

  constructor(
    private data: NetworkData,
    private vehicles?: VehicleManager,
  ) {}

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-3000, -2000, 8000);
    scene.add(sun);

    for (const line of this.data.lines) {
      const group = new THREE.Group();
      group.name = `line-${line.key}`;
      group.add(buildTrackDeck(line));
      const { line: centerline, material } = buildTrackLine(line);
      group.add(centerline);
      this.lineMaterials.push(material);
      group.add(buildStationMarkers([line]));
      scene.add(group);
      this.lineGroups.push(group);
    }
    if (this.vehicles) scene.add(...this.vehicles.meshes);
    this.scene = scene;
  }

  /** Show/hide one line's track + stations. Vehicles are hidden separately by
   *  VehicleManager, which owns their instance counts. */
  setLineVisible(index: number, visible: boolean): void {
    const group = this.lineGroups[index];
    if (group) group.visible = visible;
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.renderer || !this.scene) return;
    this.beforeRender?.();
    // maplibre-gl v5+ passes an args object; `defaultProjectionData.mainMatrix`
    // is the mercator(0..1)->clip matrix that v4 handed over as `matrix`.
    const matrix = options.defaultProjectionData.mainMatrix;
    this.projection.fromArray(matrix as unknown as number[]).multiply(this.originMatrix);
    this.camera.projectionMatrix = this.projection;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const m of this.lineMaterials) m.resolution.copy(size);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.scene = null;
    this.lineMaterials = [];
    this.lineGroups = [];
    // The GL context belongs to MapLibre — dispose Three's wrapper only.
    this.renderer?.dispose();
    this.renderer = null;
  }
}
