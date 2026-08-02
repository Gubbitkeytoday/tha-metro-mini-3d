import * as THREE from "three";
import { stationName } from "../i18n/languages";
import type { LineGeometry } from "../types";
import { lngLatAltToLocal } from "./coordinates";

/**
 * Floating 3D station-name labels, in the spirit of the place names PUBG
 * paints over its map from the plane: the name is anchored to the place in
 * world space, stands upright above it, always faces you, and fades in and out
 * with distance so the world never turns into a wall of text.
 *
 * **Stations only.** Lines are already named in the legend and a label per
 * line would double the clutter for no new information; a station is the thing
 * you actually want to identify while flying over the city.
 *
 * ## How it is drawn
 *
 * Each label is a single textured quad with the name rendered into a canvas
 * texture. Alternatives considered and rejected:
 *
 * - **DOM overlays** (a `<div>` per station projected each frame): 193 elements
 *   reflowing every frame is exactly the per-frame React/DOM work SRS §3A.7
 *   exists to forbid, and they can't be depth-sorted against the 3D scene.
 * - **`TextGeometry`**: needs a font payload and produces thousands of
 *   triangles per name for text that is always camera-facing anyway.
 * - **`THREE.Sprite`**, the obvious choice, is the one thing that CANNOT work
 *   here. Three billboards a sprite in *view* space, but this layer's camera
 *   is a bare matrix holder — `ThreeLayer` folds MapLibre's mercator→clip
 *   matrix straight into `camera.projectionMatrix` and leaves the camera's
 *   world transform as the identity (SRS §3A.4/§3A.5, the floating-origin
 *   scheme). With an identity view matrix, "view space" *is* world space, so
 *   every sprite would billboard against the world axes and lie flat on the
 *   ground. These are plain meshes billboarded by hand in `faceCamera()`
 *   against the real camera position, which has to be read from MapLibre.
 *
 * The per-frame cost is a distance, a quaternion and an opacity write per
 * label — no geometry rebuilds, no layout, nothing allocated.
 *
 * ## One language, by choice
 *
 * A label shows the station's name in the SELECTED language and nothing else —
 * picking Thai means Thai, picking English means English. (It used to always
 * stack English over Thai, which is how the stations are signed but is twice
 * the clutter for a reader who only needs one of them.) Textures are rebuilt
 * when the language changes, not per frame.
 *
 * Long names wrap onto at most two lines instead of stretching into a banner
 * wider than the screen — "Queen Sirikit National Convention Centre" as one
 * line is unreadable and crowds out every neighbour in the declutter pass.
 */

/** Texture pixels for the English name's cap height — the sharpness dial. */
const TEXTURE_PX = 64;

/**
 * Label size as a fraction of its distance from the camera.
 *
 * A label sized in fixed world metres is unusable across this app's zoom
 * range: readable over one station means a smear of overlapping text when the
 * whole city is in frame, and vice versa. Scaling with distance instead gives
 * a roughly constant *angular* size — the label stays about as big on screen
 * wherever you are, which is how PUBG's place names behave.
 */
const ANGULAR_SIZE = 0.032;

/**
 * Clamps on the above, in metres.
 *
 * The maximum has to be generous — it is a backstop against absurd geometry,
 * not a size limit. Angular sizing already bounds how big a label gets *on
 * screen*, so a tight cap does nothing useful and quietly breaks the far view:
 * at 420 m the clamp bound from about 13 km out, and by the whole-region
 * "before you jump" altitude every name had shrunk to a few unreadable pixels.
 */
const MIN_HEIGHT_M = 30;
const MAX_HEIGHT_M = 4_000;

/**
 * How far above the platform the label floats, also as a fraction of camera
 * distance — a fixed offset would bury the label in the track when zoomed out
 * and strand it in the sky when zoomed in.
 */
const HOVER_FRACTION = 0.045;
const MIN_HOVER_M = 30;
const MAX_HOVER_M = 5_000;

/** Breathing room around each label's collision box, in screen pixels. */
const COLLISION_PADDING_PX = 5;

/**
 * Distance band, in metres from the camera, over which a label is drawn.
 *
 * The band is deliberately very wide, because labels are sized by *angle*
 * rather than in metres: a station 50 km away is drawn at the same screen size
 * as one 500 m away, so distance alone is no reason to hide it. What actually
 * keeps a 193-label network readable when the whole region is in frame is the
 * screen-space declutter pass, not the far cut — the far cut only exists so
 * that pulling right out doesn't leave labels for places over the horizon.
 *
 * The near fade is the opposite case: standing on a platform (following a
 * train), the label for the station you are inside would otherwise fill the
 * view.
 */
export const LABEL_FADE = {
  /** Fully faded out closer than this — you are practically inside it. */
  nearOut: 70,
  /** Fully visible from here... */
  nearIn: 260,
  /** ...to here. */
  farIn: 55_000,
  /** Fully faded out beyond this. */
  farOut: 90_000,
};

/** Opacity for a label whose centre is `distance` metres from the camera. */
export function labelOpacity(distance: number): number {
  const { nearOut, nearIn, farIn, farOut } = LABEL_FADE;
  if (distance <= nearOut || distance >= farOut) return 0;
  if (distance < nearIn) return (distance - nearOut) / (nearIn - nearOut);
  if (distance > farIn) return (farOut - distance) / (farOut - farIn);
  return 1;
}

/**
 * Font stack for label text.
 *
 * The app names stations in Thai, Latin, Han, Kana, Hangul and Cyrillic, so a
 * single family is never enough — the browser walks this list per glyph. These
 * are all system faces on purpose: shipping webfonts with Thai + CJK coverage
 * would be several megabytes against NF2's 5 MB budget, for text that system
 * fonts already render better (correctly hinted, correct vertical metrics for
 * Thai's tall stacked marks).
 *
 * Thai faces come first so Thai renders in a real Thai face rather than a
 * Latin font's fallback, which is where the clipped tone marks come from.
 */
const LABEL_FONT_STACK = [
  '"Noto Sans Thai"',
  '"Leelawadee UI"',
  '"IBM Plex Sans Thai"',
  '"Sarabun"',
  '"Segoe UI"',
  '"Noto Sans"',
  '"Noto Sans CJK SC"',
  '"Microsoft YaHei"',
  '"Yu Gothic UI"',
  '"Malgun Gothic"',
  "system-ui",
  "sans-serif",
].join(", ");

/** Wrap at this many characters of the drawn line, in texture pixels. */
const MAX_LINE_PX = TEXTURE_PX * 11;

/**
 * Break `text` into at most two lines that each fit `MAX_LINE_PX`.
 *
 * Word-wrapped where there are spaces (Latin, Cyrillic, Thai romanisations);
 * for scripts that do not space their words — Thai, Chinese, Japanese — it
 * falls back to splitting near the middle by character, which is not
 * linguistically correct but is far better than a name three screens wide.
 */
export function wrapLabel(text: string, measure: (s: string) => number): string[] {
  if (!text) return [""];
  if (measure(text) <= MAX_LINE_PX) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    // Greedily fill the first line, then give the rest to the second.
    let first = words[0];
    let i = 1;
    for (; i < words.length; i++) {
      const candidate = `${first} ${words[i]}`;
      if (measure(candidate) > MAX_LINE_PX) break;
      first = candidate;
    }
    const second = words.slice(i).join(" ");
    return second ? [first, second] : [first];
  }

  // No spaces to break on: split as close to the middle as the string allows.
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)];
}

function drawLabelTexture(name: string, color: string): THREE.Texture {
  const sizePx = TEXTURE_PX;
  const padPx = Math.round(sizePx * 0.32);
  const linePx = Math.round(sizePx * 1.22);

  // Measure on a throwaway context before sizing the real canvas — a canvas
  // sized after measuring wastes no texture memory on empty margins.
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = `700 ${sizePx}px ${LABEL_FONT_STACK}`;
  probe.font = font;
  const lines = wrapLabel(name || "", (s) => probe.measureText(s).width);
  const widest = Math.max(...lines.map((l) => probe.measureText(l).width), 1);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.ceil(widest + padPx * 2));
  // Thai stacks vowels and tone marks well above the cap height and below the
  // baseline; a box sized to the Latin cap height clips them off. The extra
  // half-line of leading is what keeps ก็/ญ/ฎ intact.
  canvas.height = Math.ceil(lines.length * linePx + padPx * 2);

  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = canvas.width / 2;

  // A dark outline under light text is what keeps a name legible over both a
  // pale basemap and a night city — the label can't know what is behind it.
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = font;

  lines.forEach((line, i) => {
    const y = padPx + linePx * (i + 0.5);
    ctx.lineWidth = sizePx * 0.24;
    ctx.strokeStyle = "rgba(8, 12, 24, 0.9)";
    ctx.strokeText(line, cx, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, cx, y);
  });

  // A slim underline in the line's livery colour: it says "which line is this"
  // without spending a second text line on it, which is what the old Thai
  // subtitle was doing.
  ctx.fillStyle = color;
  const barW = Math.min(canvas.width - padPx * 2, widest);
  ctx.fillRect(cx - barW / 2, canvas.height - padPx * 0.75, barW, Math.max(2, sizePx * 0.09));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Labels are viewed at a shallow angle from far away more often than not.
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export interface StationLabel {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Texture aspect (width / height), so scaling keeps the text unstretched. */
  aspect: number;
  /** The platform's own position in the local ENU frame. */
  anchor: THREE.Vector3;
  /**
   * Set by {@link declutterStationLabels}: false when a nearer label already
   * occupies this one's patch of screen. Separate from `mesh.visible` because
   * the decluttering pass runs on a throttle while the fade runs every frame.
   */
  allowed: boolean;
  /** Inside the distance fade band this frame — the declutter pass's input. */
  inBand: boolean;
  /** Metres from the camera, refreshed each frame; the declutter sort key. */
  distance: number;
  /** Termini outrank ordinary stops when they collide. */
  priority: number;
}

/** One shared unit quad — 193 labels do not need 193 geometries. */
const LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);

/** Build one label quad per station on this line, in `language`. */
export function buildStationLabels(line: LineGeometry, language: string): StationLabel[] {
  return line.stations.map((station, index) => {
    const texture = drawLabelTexture(stationName(station, language), line.color);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // Labels are an annotation layer: they read *through* the city rather
      // than being swallowed by a building between you and the platform,
      // which is the whole point of naming a place you are flying over.
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      side: THREE.DoubleSide,
      // Unlit: a label is UI, and shading it would make names dim at night
      // exactly when they are hardest to read.
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(LABEL_GEOMETRY, material);

    const image = texture.image as HTMLCanvasElement;
    const [x, y, z] = lngLatAltToLocal(station.position);

    // Draw after the world so a label is never clipped by the track it names.
    mesh.renderOrder = 10;
    mesh.name = `label-${line.key}-${station.code || station.name}`;
    mesh.visible = false;
    // The projection matrix is rebuilt per frame and these are positioned by
    // hand each frame, so Three must not try to cull them against a frustum
    // it cannot correctly derive from this layer's camera.
    mesh.frustumCulled = false;

    // A terminus names the whole branch, so it survives a collision that an
    // intermediate stop loses. Interchange data lives engine-side and isn't
    // available at build time, so this is the cue `network.json` does carry.
    const isTerminus = index === 0 || index === line.stations.length - 1;

    return {
      mesh,
      material,
      aspect: image.width / image.height,
      anchor: new THREE.Vector3(x, y, z),
      allowed: true,
      inBand: false,
      distance: Infinity,
      priority: isTerminus ? 1 : 0,
    };
  });
}

/**
 * Screen-space decluttering — the difference between "PUBG place names" and
 * "a wall of overlapping text".
 *
 * At a city-wide zoom, 100+ labels are inside the fade band at once and most
 * of them overlap. Nearer labels win, with termini outranking intermediate
 * stops at equal distance, and anything whose box collides with an
 * already-accepted label is dropped for this pass.
 *
 * Runs on a throttle (see `ThreeLayer`), not per frame: it is O(n²) in the
 * accepted set and the answer barely changes between frames. Projection is
 * exact — it reuses the same local-ENU→clip matrix the layer renders with, so
 * the boxes it tests are the boxes actually drawn.
 */
export function declutterStationLabels(
  labels: StationLabel[],
  projection: THREE.Matrix4,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const candidates: {
    label: StationLabel;
    x: number;
    y: number;
    halfW: number;
    halfH: number;
  }[] = [];

  for (const label of labels) {
    // `inBand`, not `mesh.visible`: a label this pass rejects gets hidden, and
    // reading visibility back would latch it off for good — it could never be
    // reconsidered once the camera moved away from whatever occluded it.
    if (!label.inBand) {
      label.allowed = false;
      continue;
    }
    // Homogeneous, so `w` survives: `Vector3.applyMatrix4` does the
    // perspective divide internally and throws w away, and a point BEHIND the
    // camera (w < 0) then divides into a mirrored position that can land
    // plausibly inside the frustum. Such a label never renders — the GPU
    // clips it — but it was still winning declutter slots and hiding real
    // on-screen names behind it.
    clip.set(label.mesh.position.x, label.mesh.position.y, label.mesh.position.z, 1);
    clip.applyMatrix4(projection);
    if (clip.w <= 0) {
      label.allowed = false;
      continue;
    }
    const ndcX = clip.x / clip.w;
    const ndcY = clip.y / clip.w;
    const ndcZ = clip.z / clip.w;
    if (ndcZ < -1 || ndcZ > 1) {
      label.allowed = false;
      continue;
    }
    const x = (ndcX * 0.5 + 0.5) * viewportWidth;
    const y = (0.5 - ndcY * 0.5) * viewportHeight;

    // The quad's world height maps to a screen height through the same
    // projection; measure it rather than re-deriving the FOV, so it stays
    // correct if the camera model ever changes.
    let halfH = Math.max(
      6,
      (label.mesh.scale.y / 2) * screenScaleFor(label, projection, viewportHeight),
    );
    // A label is sized by angle, so its true screen height is a few percent
    // of the viewport. Anything wildly bigger is a projection artifact, not a
    // label: approaching the horizon `w` collapses toward zero and the divide
    // blows the box up to tens of thousands of pixels. Such a label is beyond
    // the visible world — drop it rather than let it veto the entire screen.
    if (halfH > viewportHeight * 0.5) {
      label.allowed = false;
      continue;
    }

    // Padding, not a tight box: two names that merely fail to overlap still
    // read as one run-on string. It also absorbs the sub-pixel drift between
    // this throttled pass and the frame that finally draws the label, which
    // otherwise leaves occasional 1 px collisions.
    const halfW = halfH * label.aspect + COLLISION_PADDING_PX;
    halfH += COLLISION_PADDING_PX;

    // Off-screen labels must not reserve space. Near the horizon `w` gets
    // tiny, which throws the projected box thousands of pixels off-screen at
    // an enormous size; such a label is invisible either way, but while it was
    // still a declutter candidate it could veto a name the user can actually
    // see.
    if (
      x + halfW < 0 ||
      x - halfW > viewportWidth ||
      y + halfH < 0 ||
      y - halfH > viewportHeight
    ) {
      label.allowed = false;
      continue;
    }

    candidates.push({ label, x, y, halfW, halfH });
  }

  // Nearest first, termini ahead of intermediate stops.
  //
  // Sorted on the real world distance, NOT on clip-space depth: from a
  // high-altitude view every label lands at z≈0.999 after the perspective
  // divide, so a depth sort degenerates into "whatever order they were built
  // in" and the surviving labels jump around as you pan.
  candidates.sort(
    (a, b) => b.label.priority - a.label.priority || a.label.distance - b.label.distance,
  );

  const accepted: typeof candidates = [];
  for (const c of candidates) {
    const clash = accepted.some(
      (a) =>
        Math.abs(a.x - c.x) < a.halfW + c.halfW &&
        Math.abs(a.y - c.y) < a.halfH + c.halfH,
    );
    c.label.allowed = !clash;
    if (!clash) accepted.push(c);
  }
}

/**
 * Pixels per world metre along this label's own up axis, for the collision box.
 *
 * Measured along the LABEL's up, not the world's. The quad is billboarded to
 * face the camera, so its own axes are unforeshortened on screen — but a world
 * vertical is heavily foreshortened whenever the camera is looking down, which
 * is most of the time here. Using world up made the collision boxes shrink as
 * you tilted toward top-down, and the labels piled back on top of each other
 * in exactly the dense central area they most needed separating.
 */
function screenScaleFor(
  label: StationLabel,
  projection: THREE.Matrix4,
  viewportHeight: number,
): number {
  labelUp.set(0, 1, 0).applyQuaternion(label.mesh.quaternion);
  above.copy(label.mesh.position).addScaledVector(labelUp, 1);
  projectedA.copy(label.mesh.position).applyMatrix4(projection);
  projectedB.copy(above).applyMatrix4(projection);
  return Math.hypot(projectedB.x - projectedA.x, projectedB.y - projectedA.y) * 0.5 * viewportHeight;
}

const clip = new THREE.Vector4();
const projectedA = new THREE.Vector3();
const projectedB = new THREE.Vector3();
const above = new THREE.Vector3();
const labelUp = new THREE.Vector3();

/**
 * Per-frame pass: fade, size and orient every label for the current viewer.
 *
 * Called from `ThreeLayer.render()` with the camera's position in the local
 * frame. Allocation-free — the scratch vectors below are module-level and
 * reused, because this runs 193 times a frame.
 */
const toCamera = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const basis = new THREE.Matrix4();

export function updateStationLabels(
  labels: StationLabel[],
  cameraPosition: THREE.Vector3,
  enabled: boolean,
): void {
  for (const label of labels) {
    if (!enabled) {
      label.inBand = false;
      label.mesh.visible = false;
      continue;
    }
    const distance = cameraPosition.distanceTo(label.anchor);
    label.distance = distance;
    const opacity = labelOpacity(distance);
    label.inBand = opacity > 0;
    if (!label.inBand) {
      label.mesh.visible = false;
      continue;
    }
    // Transform every in-band label, even one the last declutter pass
    // rejected: that pass runs on a throttle and projects `mesh.position`, so
    // a stale position would declutter against where the label used to be.
    label.material.opacity = opacity;

    const height = clamp(distance * ANGULAR_SIZE, MIN_HEIGHT_M, MAX_HEIGHT_M);
    label.mesh.scale.set(height * label.aspect, height, 1);

    const hover = clamp(distance * HOVER_FRACTION, MIN_HOVER_M, MAX_HOVER_M);
    label.mesh.position.set(
      label.anchor.x,
      label.anchor.y,
      label.anchor.z + hover,
    );

    // Billboard: face the viewer, but keep the label's own up axis vertical in
    // world space so a row of names shares one horizon instead of each one
    // rolling with the camera.
    toCamera.subVectors(cameraPosition, label.mesh.position).normalize();
    right.crossVectors(WORLD_UP, toCamera);
    if (right.lengthSq() < 1e-8) {
      // Looking straight down the world up-axis: any horizontal right vector
      // will do, and picking one avoids a degenerate basis (NaN rotation).
      right.set(1, 0, 0);
    }
    right.normalize();
    up.crossVectors(toCamera, right);
    basis.makeBasis(right, up, toCamera);
    label.mesh.quaternion.setFromRotationMatrix(basis);

    // In band AND not shadowed by a nearer label.
    label.mesh.visible = label.allowed;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
