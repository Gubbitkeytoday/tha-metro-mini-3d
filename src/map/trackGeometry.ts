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
 * Split a track polyline into maximal same-structure groups, with NO
 * padding — every point in every group is genuinely native to it (never a
 * point borrowed from a neighbour). This is the authoritative source of
 * "what structure does the i-th run actually represent": `splitByStructure`
 * pads these groups into runs of 2+ points for rendering, but a padded run
 * can gain its extra point from either end (see below), so `run[0]` is not
 * reliably native there — `groupByStructure`'s output, one group per run in
 * the same order, is what `buildTrackDeck` reads structure from instead.
 */
function groupByStructure(track: TrackPoint[]): TrackPoint[][] {
  const groups: TrackPoint[][] = [];
  let start = 0;
  for (let i = 1; i <= track.length; i++) {
    if (i === track.length || track[i][3] !== track[i - 1][3]) {
      groups.push(track.slice(start, i));
      start = i;
    }
  }
  return groups;
}

/**
 * Cut a track polyline into maximal same-structure runs, padding any run
 * that collapses to a single point up to the 2-point minimum
 * CatmullRomCurve3 needs — and so its portal shares a real vertex with a
 * neighbour instead of leaving a gap.
 *
 * Padding always prefers a *genuinely spare* point: a neighbour that still
 * has an unborrowed point of its own (i.e. a group of 2+ points, which
 * never itself needs padding). A single-point group borrows from the
 * nearest such neighbour, chaining the loan across however many
 * consecutive single-point groups sit in between — e.g. for
 * `[e,e,e,u,a]` (a 3-point elevated group, then two lone underground/
 * at-grade points), the underground run borrows `e`'s spare point
 * (`[e,u]`), and the at-grade run then borrows the underground run's own
 * point rather than reaching past it (`[u,a]`) — nothing is duplicated.
 * A borrow rule keyed on *position* (e.g. "only the last run ever borrows
 * backward") gets this wrong: it can't see that an earlier, non-adjacent
 * group has spare capacity, and ends up duplicating a point that a
 * same-pass neighbour already borrowed instead.
 *
 * The one shape with no spare point anywhere is a track that is one
 * unbroken chain of single-point groups start to finish (every point's
 * structure differs from both neighbours'). There, nothing is truly
 * spare — with N single points and N runs each needing 2, and path order
 * fixed, at least one run is provably forced to reuse a point twice. That
 * remaining run is resolved by chaining forward from the track's very
 * first point (the one point nothing else competes for); the trailing
 * run's own padding then necessarily reads a point some earlier run in
 * the chain already borrowed to pad itself.
 *
 * Because a padded run's extra point can land at either end depending on
 * which side the donor was found, callers that need a run's true
 * structure must not infer it from the run's own points (see
 * `groupByStructure`, which `buildTrackDeck` uses instead).
 */
export function splitByStructure(track: TrackPoint[]): TrackPoint[][] {
  if (track.length < 2) return [];

  const groups = groupByStructure(track);
  const runs: TrackPoint[][] = groups.map((g) => g.slice());

  let i = 0;
  while (i < groups.length) {
    if (groups[i].length >= 2) {
      i++;
      continue;
    }
    // [i, j) is a maximal chain of single-point groups. groups[i - 1] (if
    // it exists) and groups[j] (if it exists) bound it and are guaranteed
    // to have 2+ points — the chain is maximal, so neither could itself be
    // a single-point group without having been folded into this chain.
    let j = i;
    while (j < groups.length && groups[j].length < 2) j++;

    if (i > 0) {
      // A spare point exists on the left: chain the loan in from there.
      for (let k = i; k < j; k++) {
        const donor = k === i ? groups[i - 1] : groups[k - 1];
        runs[k] = [donor[donor.length - 1], ...runs[k]];
      }
    } else if (j < groups.length) {
      // No spare point on the left (this chain starts the track), but
      // there's one on the right — mirror the above from that side.
      for (let k = j - 1; k >= i; k--) {
        const donor = k === j - 1 ? groups[j] : groups[k + 1];
        runs[k] = [...runs[k], donor[0]];
      }
    } else {
      // No spare point on either side — the whole track is this one
      // chain. Chain forward from the track's first point; the last run's
      // own padding then reads whatever the run before it already
      // settled on, which is the one genuinely unavoidable duplication.
      for (let k = j - 1; k >= i; k--) {
        if (k + 1 < j) runs[k] = [...runs[k], runs[k + 1][0]];
        else runs[k] = [runs[k - 1][runs[k - 1].length - 1], ...runs[k]];
      }
    }
    i = j;
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
  preRevenue: boolean,
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
    transparent: preRevenue,
    opacity: preRevenue ? 0.55 : 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
  // Unbuilt track reads as a ghost: same hue, much less saturation and a
  // little transparency, so it is legible as alignment without competing
  // with lines that actually carry trains.
  const deckColor = new THREE.Color(line.color);
  if (line.preRevenue) {
    const hsl = { h: 0, s: 0, l: 0 };
    deckColor.getHSL(hsl);
    deckColor.setHSL(hsl.h, hsl.s * 0.25, Math.min(hsl.l * 1.25 + 0.15, 0.85));
  }
  const runs = splitByStructure(line.track);
  // A run's own points can include one borrowed from a neighbour (see
  // splitByStructure), so its true structure isn't reliably readable off
  // the run itself — groupByStructure's unpadded groups are, one per run,
  // in the same order.
  const structures = groupByStructure(line.track).map((g) => g[0][3]);
  for (const [i, run] of runs.entries()) {
    const structure = structures[i];
    const mesh = sweepDeck(run, profileFor(line, structure), deckColor, line.preRevenue);
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
    // A pre-revenue alignment must not read as "a train could be here" —
    // dashes are the standard transit-map convention for under-construction.
    dashed: line.preRevenue,
    dashSize: 40,
    gapSize: 30,
  });
  // LineMaterial derives its USE_DASH shader define from the `dashed`
  // constructor option, but force a recompile to be safe regardless.
  material.needsUpdate = true;
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

  discs.castShadow = true;
  discs.receiveShadow = true;
  poles.castShadow = true;
  poles.receiveShadow = true;

  // Tagged so Task 6's underground-transparency mode knows which station
  // groups contain a sub-surface platform (dim/hide) vs. which line owns them.
  discs.userData.hasSubsurface = stations.some((s) => s.position[2] < 0);
  group.userData.lineKey = lines[0]?.key ?? "";

  group.add(discs, poles);
  return group;
}
