import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import type { NetworkData } from "../types";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MERC_PER_METER, ORIGIN_MERC, cameraLocalPosition } from "./coordinates";
import { daylightFactor, type SunPosition } from "./sunPosition";
import {
  buildStationLabels,
  declutterStationLabels,
  updateStationLabels,
  type StationLabel,
} from "./stationLabels";
import { buildStationMarkers, buildTrackDecks, buildTrackLine } from "./trackGeometry";
import type { VehicleManager } from "./VehicleManager";

/**
 * Custom MapLibre layer hosting the Three.js scene (SRS §3A.4).
 *
 * Three renders into MapLibre's OWN WebGL context (never a second canvas).
 * Each frame MapLibre hands us a float64 mercator→clip matrix; we fold the
 * local-frame origin translation + meter scale into it before it ever
 * touches the GPU, so vertex data stays small (floating origin, §3A.5).
 */
const DEG = Math.PI / 180;

/** How far out to place the directional light, in local-frame metres. Only the
 *  direction matters for a directional light; this just needs to be clear of
 *  the scene. */
const SUN_DISTANCE_M = 12_000;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** ~8 Hz — see the call site for why this isn't per frame. */
const DECLUTTER_INTERVAL_MS = 125;

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
   * Every material belonging to a below-ground deck segment, across all lines
   * (MVP 6 F3.2). Collected at build time because the underground-transparency
   * toggle has to reach them without re-walking the scene each time it flips.
   */
  private undergroundMaterials: THREE.MeshLambertMaterial[] = [];
  /** Scene lights, kept so the day/night toggle can retune them in place. */
  private ambient: THREE.AmbientLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  /** Every station label across every line, walked once per frame. */
  private labels: StationLabel[] = [];
  private labelsEnabled = true;
  /** Language the label textures are currently rendered in. */
  private language = "en";
  /** Set in onAdd — the only way to learn where the viewer actually is. */
  private map: MapLibreMap | null = null;
  private cameraPosition = new THREE.Vector3();
  private lastDeclutterMs = 0;
  /** Unit vector from the shadow target toward the sun. */
  private sunDirection = new THREE.Vector3(0, 0, 1);
  private shadowsEnabled = false;
  /** Track decks and vehicle meshes — everything that can cast or receive. */
  private shadowCasters: THREE.Mesh[] = [];

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
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;

    const scene = new THREE.Scene();
    this.ambient = new THREE.AmbientLight(0xffffff, 1.6);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(-3000, -2000, 8000);
    // 2048² is the largest map worth paying for here: the frustum is only a
    // few km wide, so this is already sub-metre per texel.
    this.sun.shadow.mapSize.set(2048, 2048);
    // Deck geometry is a thin box; without a bias it shadow-acnes itself.
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun);
    scene.add(this.sun.target);

    for (const line of this.data.lines) {
      const group = new THREE.Group();
      group.name = `line-${line.key}`;
      for (const { mesh, structure } of buildTrackDecks(line)) {
        group.add(mesh);
        this.shadowCasters.push(mesh);
        if (structure === "underground") {
          this.undergroundMaterials.push(mesh.material as THREE.MeshLambertMaterial);
        }
      }
      const { line: centerline, material } = buildTrackLine(line);
      group.add(centerline);
      this.lineMaterials.push(material);
      group.add(buildStationMarkers([line]));
      scene.add(group);
      this.lineGroups.push(group);
    }
    if (this.vehicles) {
      scene.add(...this.vehicles.meshes);
      // The far-view dots live alongside the trains. Deliberately not a shadow
      // caster: a dot is a map symbol, and a 400 m disc casting a shadow onto
      // the city would be absurd.
      scene.add(this.vehicles.markers);
      for (const mesh of this.vehicles.meshes) this.shadowCasters.push(mesh);
    }
    // Publish the scene BEFORE building labels: `rebuildLabels()` bails out
    // when `this.scene` is null (it is also the language-change path, which
    // can fire before the layer is added), so calling it first silently
    // produced a network with no labels at all.
    this.scene = scene;
    this.rebuildLabels();
  }

  /** Show/hide one line's track + stations. Vehicles are hidden separately by
   *  VehicleManager, which owns their instance counts. */
  setLineVisible(index: number, visible: boolean): void {
    const group = this.lineGroups[index];
    if (group) group.visible = visible;
  }

  /**
   * Underground transparency (SRS F3.2). Off, a tunnel deck is an ordinary
   * opaque mesh — correctly depth-tested, so MapLibre's 3D building extrusions
   * and anything else in front of it hide it, which is what "underground"
   * should look like. On, those same decks become translucent AND stop
   * depth-testing, so they read *through* the city above them.
   *
   * `depthTest: false` (rather than only lowering opacity) is the load-bearing
   * half: a tunnel at −18 m is behind the ground plane and the buildings from
   * almost every camera angle, so a merely-translucent tunnel would still be
   * completely occluded and the toggle would appear to do nothing.
   */
  setUndergroundVisible(transparent: boolean): void {
    for (const material of this.undergroundMaterials) {
      material.transparent = transparent;
      material.opacity = transparent ? 0.45 : 1;
      material.depthTest = !transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
  }

  /**
   * Shadow quality (SRS §3A.5's "quality toggle on mobile").
   *
   * **Scope, stated plainly:** Three can only shadow geometry it owns, so this
   * is trains and track decks casting onto each other. MapLibre draws the
   * city's building extrusions in its own pass, and nothing in this layer can
   * cast onto them or receive from them without re-implementing the basemap in
   * Three — that is why it defaults OFF rather than being always on.
   *
   * The shadow camera is a tight orthographic box that follows the viewer
   * (`updateShadowFrustum`) rather than covering the whole 60 km network: a
   * city-sized frustum in a 2048² map gives roughly 30 m per texel, at which
   * point a train's shadow is a single blurry pixel.
   */
  setShadows(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    if (this.renderer) {
      this.renderer.shadowMap.enabled = enabled;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    if (this.sun) this.sun.castShadow = enabled;
    for (const mesh of this.shadowCasters) {
      mesh.castShadow = enabled;
      mesh.receiveShadow = enabled;
    }
  }

  /**
   * Keep the shadow camera boxed around what the viewer can actually see.
   *
   * Sized from the camera's height, so it grows as you pull out and stays
   * tight when you drop in — the resolution/coverage trade-off SRS §3A.5 calls
   * for, applied per frame instead of picked once.
   */
  private updateShadowFrustum(): void {
    if (!this.sun || !this.shadowsEnabled) return;
    const cam = this.sun.shadow.camera;
    // Cover roughly the ground area in frame, clamped so a region-wide view
    // doesn't blur the map into uselessness.
    const half = Math.min(4_000, Math.max(400, this.cameraPosition.z * 0.9));
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = SUN_DISTANCE_M * 2;
    // The light is directional: only its direction matters for shading, but
    // the shadow camera has to actually contain the scene, so re-anchor the
    // light and its target over wherever the viewer is looking.
    this.sun.target.position.set(this.cameraPosition.x, this.cameraPosition.y, 0);
    this.sun.target.updateMatrixWorld();
    this.placeSun();
    cam.updateProjectionMatrix();
  }

  /** Show or hide the floating station-name labels. */
  setStationLabelsVisible(visible: boolean): void {
    this.labelsEnabled = visible;
    if (!visible) for (const label of this.labels) label.mesh.visible = false;
  }

  /**
   * Re-render every label in `language`.
   *
   * Label text lives in a canvas texture, so a language change means new
   * textures — there is no cheaper way, and no reason for one: this runs on a
   * user action, never per frame. The old textures are disposed explicitly
   * because a `CanvasTexture` holds a canvas the GC will not reclaim while the
   * GPU handle is alive.
   */
  setLanguage(language: string): void {
    if (language === this.language) return;
    this.language = language;
    if (this.scene) this.rebuildLabels();
  }

  private rebuildLabels(): void {
    const scene = this.scene;
    if (!scene) return;

    for (const label of this.labels) {
      label.mesh.removeFromParent();
      label.material.map?.dispose();
      label.material.dispose();
    }
    this.labels = [];

    this.data.lines.forEach((line, index) => {
      const group = this.lineGroups[index];
      if (!group) return;
      for (const label of buildStationLabels(line, this.language)) {
        group.add(label.mesh);
        this.labels.push(label);
      }
    });
    // A fresh label starts hidden; the next frame's fade pass decides.
    if (!this.labelsEnabled) for (const label of this.labels) label.mesh.visible = false;
  }

  /**
   * Point the directional light at the real sun for this moment, and colour
   * the scene for that time of day (SRS F3.3).
   *
   * Driven by the *simulated* clock, so scrubbing to 06:00 gives a low sun in
   * the east and scrubbing to 19:00 gives night — the first MVP 6 pass made
   * this a manual boolean, which is not what F3.3 asks for.
   *
   * Everything interpolates on `daylightFactor` rather than switching at the
   * horizon, so scrubbing through dawn reads as a sunrise. Two separate
   * ramps are at work: overall brightness follows the daylight factor, while
   * warmth peaks when the sun is *near* the horizon in either direction —
   * that's what makes golden hour look like golden hour rather than just a
   * dimmer noon.
   */
  setSun(sun: SunPosition): void {
    const day = daylightFactor(sun.altitudeDeg);
    // 1 at the horizon, 0 once the sun is well up — the golden-hour term.
    const lowSun = Math.max(0, 1 - Math.abs(sun.altitudeDeg) / 18);

    if (this.ambient) {
      // Cool moonlight-blue at night, neutral white by day.
      this.ambient.color.setRGB(
        lerp(0.53, 1, day),
        lerp(0.6, 1, day),
        lerp(0.8, 1, day),
      );
      this.ambient.intensity = lerp(1.1, 1.6, day);
    }

    if (this.sun) {
      // Warm the sun toward amber as it approaches the horizon.
      this.sun.color.setRGB(1, lerp(1, 0.78, lowSun), lerp(1, 0.5, lowSun));
      // A floor rather than zero at night: the city is lit, and a scene with
      // no directional term at all goes flat and unreadable.
      this.sun.intensity = lerp(0.45, 2.2, day);

      // Azimuth is clockwise from north; the local frame is x east, y north,
      // z up. Below the horizon the light is clamped just above it — a light
      // *under* the city would rim everything from beneath, which reads as a
      // rendering bug rather than as night.
      const altRad = Math.max(sun.altitudeDeg, 8) * DEG;
      const azRad = sun.azimuthDeg * DEG;
      const horizontal = Math.cos(altRad);
      this.sunDirection.set(
        horizontal * Math.sin(azRad),
        horizontal * Math.cos(azRad),
        Math.sin(altRad),
      );
      this.placeSun();
    }
  }

  /**
   * Put the light at `target + direction * distance`.
   *
   * A directional light's *position* is meaningless for shading — only the
   * vector from target to position is — but it is what the shadow camera is
   * built around, so it has to follow the shadow target as that tracks the
   * viewer. Setting an absolute position once would leave the shadow frustum
   * behind the moment the map was panned.
   */
  private placeSun(): void {
    if (!this.sun) return;
    this.sun.position
      .copy(this.sun.target.position)
      .addScaledVector(this.sunDirection, SUN_DISTANCE_M);
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.renderer || !this.scene) return;

    // The viewer's real position, computed once per frame and reused by the
    // fleet scaling, the shadow frustum and the labels. It has to come BEFORE
    // `beforeRender` poses the fleet: the vehicle manager enlarges trains as
    // the camera pulls back so they do not vanish, and using last frame's
    // value would make that lag visibly while zooming.
    if (this.map) {
      const map = this.map;
      this.cameraPosition.set(
        ...cameraLocalPosition({
          center: map.getCenter(),
          zoom: map.getZoom(),
          pitchDeg: map.getPitch(),
          bearingDeg: map.getBearing(),
          heightPx: map.getCanvas().clientHeight,
        }),
      );
      // Distance to what the camera is LOOKING AT, not to the local origin:
      // the origin is Siam, so an origin-relative distance would enlarge the
      // trains over Bang Na while zoomed right in. Altitude over cos(pitch)
      // is exactly the camera-to-centre distance in MapLibre's model.
      const pitch = (map.getPitch() * Math.PI) / 180;
      this.vehicles?.setViewScale(this.cameraPosition.z / Math.max(0.2, Math.cos(pitch)));
      this.vehicles?.setCameraPosition(this.cameraPosition);
    }

    this.beforeRender?.();
    // maplibre-gl v5+ passes an args object; `defaultProjectionData.mainMatrix`
    // is the mercator(0..1)->clip matrix that v4 handed over as `matrix`.
    const matrix = options.defaultProjectionData.mainMatrix;
    this.projection.fromArray(matrix as unknown as number[]).multiply(this.originMatrix);
    this.camera.projectionMatrix = this.projection;

    // `cameraPosition` was filled above, before the fleet was posed.
    if (this.map) {
      const map = this.map;
      this.updateShadowFrustum();

      updateStationLabels(this.labels, this.cameraPosition, this.labelsEnabled);

      // Decluttering is O(n²) in the accepted set, so it runs on a throttle
      // rather than every frame — the verdict barely changes between frames,
      // and the fade above already runs at full rate so labels never look
      // frozen. 8 Hz is fast enough that panning doesn't visibly lag it.
      const now = performance.now();
      if (this.labelsEnabled && now - this.lastDeclutterMs >= DECLUTTER_INTERVAL_MS) {
        this.lastDeclutterMs = now;
        declutterStationLabels(
          this.labels,
          this.projection,
          map.getCanvas().clientWidth,
          map.getCanvas().clientHeight,
        );
      }
    }
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
    this.undergroundMaterials = [];
    this.ambient = null;
    this.sun = null;
    // Label textures are canvas-backed and not reachable by the Mesh sweep
    // above once the scene reference is dropped, so free them explicitly.
    for (const label of this.labels) label.material.map?.dispose();
    this.labels = [];
    this.shadowCasters = [];
    this.map = null;
    // The GL context belongs to MapLibre — dispose Three's wrapper only.
    this.renderer?.dispose();
    this.renderer = null;
  }
}
