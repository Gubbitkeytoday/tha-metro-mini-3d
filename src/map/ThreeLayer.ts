import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";
import type { GreenLineData } from "../types";
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
export class GreenLineLayer implements CustomLayerInterface {
  id = "green-line-3d";
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

  /**
   * Per-frame hook, invoked at the start of every render() before drawing —
   * MapContainer uses it to push interpolated vehicle poses into the
   * VehicleManager without touching React/Zustand (SRS §3A.7).
   */
  beforeRender: (() => void) | null = null;

  constructor(
    private data: GreenLineData,
    private vehicles?: VehicleManager,
  ) {}

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
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

    const branches = [this.data.branches.sukhumvit, this.data.branches.silom];
    for (const branch of branches) {
      scene.add(buildTrackDeck(branch));
      const { line, material } = buildTrackLine(branch);
      scene.add(line);
      this.lineMaterials.push(material);
    }
    scene.add(buildStationMarkers(branches));
    if (this.vehicles) scene.add(...this.vehicles.meshes);
    this.scene = scene;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: ArrayLike<number>): void {
    if (!this.renderer || !this.scene) return;
    this.beforeRender?.();
    this.projection.fromArray(matrix as number[]).multiply(this.originMatrix);
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
    // The GL context belongs to MapLibre — dispose Three's wrapper only.
    this.renderer?.dispose();
    this.renderer = null;
  }
}
