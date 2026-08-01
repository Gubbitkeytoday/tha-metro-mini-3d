import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry as ThreeLineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { LineGeometry, Structure } from "../types";
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
function profileFor(line: LineGeometry) {
  const beam = line.vehicleType === "monorail" || line.vehicleType === "apm";
  return beam ? DECK_PROFILE.monorail : DECK_PROFILE[line.structure];
}

/** Resample interval along the smoothed curve. */
const SAMPLE_SPACING_M = 12;

const UP = new THREE.Vector3(0, 0, 1);

function toLocalVec3(points: LineGeometry["track"]): THREE.Vector3[] {
  return points.map((p) => new THREE.Vector3(...lngLatAltToLocal(p)));
}

/**
 * Sweep a rectangular viaduct-deck profile along the smoothed track curve.
 * Produces one indexed BufferGeometry (top, bottom and both side faces).
 */
export function buildTrackDeck(line: LineGeometry): THREE.Mesh {
  const controlPoints = toLocalVec3(line.track);
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal");
  const length = curve.getLength();
  const samples = Math.max(controlPoints.length, Math.round(length / SAMPLE_SPACING_M));

  const centers = curve.getSpacedPoints(samples);
  const { widthM, depthM } = profileFor(line);
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
    color: new THREE.Color(line.color),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `track-${line.key}`;
  return mesh;
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
    // unit-height pole scaled to reach from ground to deck
    m.makeScale(1, 1, z).setPosition(x, y, z / 2);
    poles.setMatrixAt(i, m);
  }
  discs.instanceMatrix.needsUpdate = true;
  if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
  poles.instanceMatrix.needsUpdate = true;

  group.add(discs, poles);
  return group;
}
