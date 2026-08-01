import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry as ThreeLineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { LineGeometry, Structure, TrackPoint } from "../types";
import { lngLatAltToLocal } from "./coordinates";

/**
 * Track & station geometry builders. Everything is generated in the local
 * ENU meter frame (x east, y north, z up) — see coordinates.ts.
 *
 * Track paths are spline-smoothed with a centripetal Catmull-Rom curve so
 * heading changes stay continuous at curve nodes (SRS §F1.3).
 */

/**
 * Deck cross-section per structure type. Elevated keeps MVP 1's 9 m × 2 m
 * viaduct box; at-grade is a shallow ballast slab (a 2 m box at +0.5 m would
 * sink through the ground plane); `monorail` is the narrow straddle beam used
 * by the Pink/Yellow/Gold guideways.
 */
export const DECK_PROFILE: Record<Structure | "monorail", { widthM: number; depthM: number }> = {
  elevated: { widthM: 9, depthM: 2 },
  atGrade: { widthM: 8, depthM: 0.5 },
  underground: { widthM: 9, depthM: 2 },
  monorail: { widthM: 5, depthM: 1.6 },
};

/** Monorail/APM guideways are beams, not viaducts, whatever their altitude. */
function profileFor(line: LineGeometry, structure: Structure) {
  const beam = line.vehicleType === "monorail" || line.vehicleType === "apm";
  return beam ? DECK_PROFILE.monorail : DECK_PROFILE[structure];
}

/** Resample interval along the smoothed curve. */
const SAMPLE_SPACING_M = 12;

const UP = new THREE.Vector3(0, 0, 1);

// TrackPoint carries [lng, lat, alt, structure]; only the first three fields
// are geographic — slice them off before handing a point to the LngLatAlt API.
function toLocalVec3(points: TrackPoint[]): THREE.Vector3[] {
  return points.map((p) => new THREE.Vector3(...lngLatAltToLocal([p[0], p[1], p[2]])));
}

/**
 * Cut a track polyline into maximal same-structure runs.
 *
 * A run of 2+ points needs no help: sweepDeck curves through it on its own,
 * and the next run picks up cleanly at the very next original point, so
 * there's no gap to begin with. A run that collapses to a single point (its
 * structure holds for only one sample) borrows one point from the
 * neighbouring run — CatmullRomCurve3 throws below 2 points, and this also
 * gives that portal a shared vertex instead of a hole between the last
 * sample of one structure and the first of the next.
 *
 * Only the very last run can ever borrow *backward* (prepending its
 * predecessor's last point) — every other short run borrows *forward*
 * (appending its successor's first point), because path order forbids
 * putting a later point before an earlier one. That asymmetry is why the
 * padding pass below walks **right to left**: the last run's backward
 * borrow always reads its predecessor's still-untouched, genuinely native
 * last point (nothing to its left has been visited yet), and any earlier
 * run's forward borrow then reads whatever its successor already settled
 * on. A left-to-right pass gets this backwards — an earlier run pads
 * itself first (mutating in place), so by the time the last run looks left
 * for its "predecessor's last point" it reads that mutation instead of the
 * predecessor's own point, producing a degenerate self-duplicated run (see
 * the regression tests below the two-segment case this bit).
 *
 * `buildTrackDeck` relies on this ordering: for every run except the last,
 * `run[0]` is guaranteed native (never a borrowed point), so it can read
 * `run[0][3]` for the run's true structure; the last run instead reads
 * `run[run.length - 1][3]`, which is native there for the same reason.
 */
export function splitByStructure(track: TrackPoint[]): TrackPoint[][] {
  if (track.length < 2) return [];

  const runs: TrackPoint[][] = [];
  let start = 0;
  for (let i = 1; i <= track.length; i++) {
    if (i === track.length || track[i][3] !== track[i - 1][3]) {
      runs.push(track.slice(start, i));
      start = i;
    }
  }

  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].length >= 2) continue;
    if (i + 1 < runs.length) runs[i] = [...runs[i], runs[i + 1][0]];
    else runs[i] = [runs[i - 1][runs[i - 1].length - 1], ...runs[i]];
  }

  return runs;
}

/**
 * Sweep the deck profile along one same-structure run of track points.
 * Produces one indexed BufferGeometry (top, bottom and both side faces).
 */
function sweepDeck(
  points: TrackPoint[],
  profile: { widthM: number; depthM: number },
  color: THREE.Color,
): THREE.Mesh {
  const controlPoints = toLocalVec3(points);
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal");
  const length = curve.getLength();
  const samples = Math.max(controlPoints.length, Math.round(length / SAMPLE_SPACING_M));

  const centers = curve.getSpacedPoints(samples);
  const { widthM, depthM } = profile;
  const halfW = widthM / 2;

  // 4 profile corners per sample: topLeft, topRight, bottomRight, bottomLeft
  const positions = new Float32Array(centers.length * 4 * 3);
  const side = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const t = i / (centers.length - 1);
    tangent.copy(curve.getTangentAt(Math.min(Math.max(t, 0), 1)));
    tangent.z = 0; // keep the deck level even on (rare) sloped segments
    if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
    tangent.normalize();
    side.crossVectors(tangent, UP).multiplyScalar(halfW);

    const corners = [
      [c.x - side.x, c.y - side.y, c.z],
      [c.x + side.x, c.y + side.y, c.z],
      [c.x + side.x, c.y + side.y, c.z - depthM],
      [c.x - side.x, c.y - side.y, c.z - depthM],
    ];
    for (let k = 0; k < 4; k++) positions.set(corners[k], (i * 4 + k) * 3);
  }

  const indices: number[] = [];
  for (let i = 0; i < centers.length - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // top (0-1), right side (1-2), bottom (2-3), left side (3-0)
    for (let e = 0; e < 4; e++) {
      const e2 = (e + 1) % 4;
      indices.push(a + e, b + e, b + e2, a + e, b + e2, a + e2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Sweep the deck profile along each same-structure run of the track.
 *
 * Returns a Group (was a single Mesh through MVP 5): a line may now change
 * structure mid-route, and each band needs its own cross-section AND its own
 * material, so the underground-transparency mode can address them separately.
 * Each child mesh's `userData.structure` is what ThreeLayer sorts on.
 */
export function buildTrackDeck(line: LineGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = `track-${line.key}`;
  const color = new THREE.Color(line.color);
  const runs = splitByStructure(line.track);
  for (const [i, run] of runs.entries()) {
    // run[0] is native to every run EXCEPT the last one — splitByStructure
    // only ever pads a short run by prepending a borrowed point (path order
    // forbids appending a point that comes earlier in the track), and only
    // the last run can be short with nothing after it to append instead. See
    // splitByStructure's doc comment for the full reasoning.
    const structure = (i === runs.length - 1 ? run[run.length - 1] : run[0])[3];
    const mesh = sweepDeck(run, profileFor(line, structure), color);
    mesh.name = `track-${line.key}-${structure}-${i}`;
    mesh.userData.structure = structure;
    group.add(mesh);
  }
  return group;
}

/**
 * Constant-screen-width centerline drawn along the smoothed track. The 3D
 * deck is metric (9 m wide) and drops below a pixel at low zoom; this line
 * keeps the route readable at any zoom. Its material needs the drawing-buffer
 * resolution each frame — the layer updates it in render().
 */
export function buildTrackLine(line: LineGeometry): { line: Line2; material: LineMaterial } {
  const controlPoints = toLocalVec3(line.track);
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal");
  const samples = Math.max(controlPoints.length, Math.round(curve.getLength() / SAMPLE_SPACING_M));
  // hover slightly above the deck top to avoid z-fighting
  const positions = curve
    .getSpacedPoints(samples)
    .flatMap((p) => [p.x, p.y, p.z + 0.6]);

  const geometry = new ThreeLineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: new THREE.Color(line.color).getHex(),
    linewidth: 3, // pixels (worldUnits: false is the default)
  });
  const line2 = new Line2(geometry, material);
  line2.computeLineDistances();
  line2.name = `trackline-${line.key}`;
  return { line: line2, material };
}

/**
 * Vertical scale + center for a station's support pole, given the platform
 * altitude. Handles both signs: an underground platform's "pole" is a shaft
 * from ground level DOWN to the platform, which needs a positive scale and a
 * negative center — not the negative scale a naive makeScale(1,1,z) produces
 * (negative scale inverts face winding and the pole lights black).
 */
export function poleTransform(altitudeM: number): { scaleZ: number; centerZ: number } {
  const scaleZ = Math.max(Math.abs(altitudeM), 0.5);
  return { scaleZ, centerZ: altitudeM / 2 };
}

/**
 * Station markers as two InstancedMeshes (discs at deck level + support
 * poles to the ground) per line — `ThreeLayer.ts` calls this once per
 * registered line, so at today's 9-line network that's ~18 draw calls
 * total, not a handful (SRS §3A.5 instancing pattern; still O(lines), not
 * O(stations)).
 */
export function buildStationMarkers(lines: LineGeometry[]): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "stations";

  const stations = lines.flatMap((line) =>
    line.stations.map((s) => ({ ...s, color: new THREE.Color(line.color) })),
  );
  if (stations.length === 0) return group;

  const discGeo = new THREE.CylinderGeometry(16, 16, 2.5, 24);
  discGeo.rotateX(Math.PI / 2); // cylinder axis Y -> Z (our up)
  const discMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const discs = new THREE.InstancedMesh(discGeo, discMat, stations.length);

  const poleGeo = new THREE.CylinderGeometry(1.1, 1.1, 1, 10);
  poleGeo.rotateX(Math.PI / 2);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, stations.length);

  const m = new THREE.Matrix4();
  for (let i = 0; i < stations.length; i++) {
    const [x, y, z] = lngLatAltToLocal(stations[i].position);
    m.makeTranslation(x, y, z + 1.5);
    discs.setMatrixAt(i, m);
    discs.setColorAt(i, stations[i].color);
    // unit-height pole scaled to reach from ground to the platform, whichever
    // side of ground level that is (see poleTransform for the underground case)
    const { scaleZ, centerZ } = poleTransform(z);
    m.makeScale(1, 1, scaleZ).setPosition(x, y, centerZ);
    poles.setMatrixAt(i, m);
  }
  discs.instanceMatrix.needsUpdate = true;
  if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
  poles.instanceMatrix.needsUpdate = true;

  // Tagged so Task 6's underground-transparency mode knows which station
  // groups contain a sub-surface platform (dim/hide) vs. which line owns them.
  discs.userData.hasSubsurface = stations.some((s) => s.position[2] < 0);
  group.userData.lineKey = lines[0]?.key ?? "";

  group.add(discs, poles);
  return group;
}
