import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { VehicleType } from "../types";

/**
 * Rolling stock, built as geometry in code rather than loaded as models.
 *
 * Why not a `.glb`: the four fleets need only a few hundred triangles each to
 * read correctly at these camera distances, and generating them here keeps the
 * whole thing inside NF2's 5 MB budget with no asset pipeline, no licence to
 * track and no loading state to design around. It also lets every car take its
 * route's livery colour at build time, which a shared model file could not do
 * without a material swap per route.
 *
 * The silhouette is what does the work at map scale — a train is a few dozen
 * pixels long even when you are close. So each car is an extruded rounded
 * cross-section (a tube, not a box), banded with dark glazing and a livery
 * stripe, sitting on a dark underframe. The lead car gets a tapered nose and a
 * raked windscreen. Those four cues are enough to read "train, facing that
 * way, on that line" instantly; more detail would be invisible.
 */

export interface ConsistSpec {
  cars: number;
  carLengthM: number;
  gapM: number;
  widthM: number;
  heightM: number;
  /** Clearance between deck (vehicle z) and car underside. */
  rideHeightM: number;
  /** How far the lead car's nose tapers in. */
  noseLengthM: number;
  /** Corner radius of the body cross-section. */
  filletM: number;
}

export const CONSISTS: Record<VehicleType, ConsistSpec> = {
  // BTS/MRT heavy metro: 4 × 15.8 m + 3 × 0.6 m = 65.0 m, as in MVP 3.
  heavy: {
    cars: 4, carLengthM: 15.8, gapM: 0.6, widthM: 3.2, heightM: 3.8,
    rideHeightM: 0.4, noseLengthM: 2.6, filletM: 0.75,
  },
  // Pink/Yellow straddle monorail: narrower, shorter, sits low on its beam.
  monorail: {
    cars: 4, carLengthM: 11.8, gapM: 0.5, widthM: 3.0, heightM: 3.6,
    rideHeightM: 0.2, noseLengthM: 2.2, filletM: 0.9,
  },
  // Gold Line APM: 3-car people mover, the shortest thing on the network.
  apm: {
    cars: 3, carLengthM: 12.6, gapM: 0.5, widthM: 2.8, heightM: 3.4,
    rideHeightM: 0.2, noseLengthM: 1.8, filletM: 0.8,
  },
  // SRT Red commuter EMU: longest cars, boxier profile.
  commuter: {
    cars: 4, carLengthM: 20, gapM: 0.8, widthM: 3.1, heightM: 4.0,
    rideHeightM: 0.5, noseLengthM: 3.0, filletM: 0.55,
  },
};

/** Body shell — near-white, so the livery stripe and glazing carry the colour. */
const BODY = new THREE.Color(0xe8ecf0);
/** Glazing: dark enough to read as windows against the body at any zoom. */
const GLASS = new THREE.Color(0x243244);
/** Underframe, bogies and couplings. */
const UNDERFRAME = new THREE.Color(0x3b434e);
/** Roof equipment. */
const ROOF_KIT = new THREE.Color(0x9aa4b0);

export function consistLengthM(spec: ConsistSpec): number {
  return spec.cars * spec.carLengthM + (spec.cars - 1) * spec.gapM;
}

/**
 * Paint a geometry with a single vertex colour, and normalise it to
 * non-indexed on the way through.
 *
 * `mergeGeometries` returns null — silently, with only a console warning — if
 * the inputs disagree about indexing, and this model mixes `BoxGeometry`
 * (indexed) with `ExtrudeGeometry` (not). Converting here means every part
 * goes through one place and the merge cannot be broken by adding a new kind
 * of part later.
 */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  let g = geometry;
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * The car's cross-section, seen head-on: a rectangle with rounded upper
 * corners and slightly tucked lower ones — the profile every modern EMU has,
 * and the single cheapest thing that stops a train looking like a brick.
 *
 * Drawn in the (y, z) plane with z measured from the car floor.
 */
function bodyProfile(spec: ConsistSpec): THREE.Shape {
  const halfW = spec.widthM / 2;
  const h = spec.heightM;
  const r = Math.min(spec.filletM, halfW * 0.9, h * 0.4);
  const tuck = Math.min(0.18, halfW * 0.12);

  const shape = new THREE.Shape();
  shape.moveTo(-halfW + tuck, 0);
  shape.lineTo(halfW - tuck, 0);
  shape.lineTo(halfW, tuck);
  shape.lineTo(halfW, h - r);
  shape.quadraticCurveTo(halfW, h, halfW - r, h);
  shape.lineTo(-halfW + r, h);
  shape.quadraticCurveTo(-halfW, h, -halfW, h - r);
  shape.lineTo(-halfW, tuck);
  shape.closePath();
  return shape;
}

/**
 * Extrude the profile along +x for `length`, its rear face at `xStart`.
 *
 * Anchored at the START, not the centre: the extrusion already runs from 0 to
 * `depth` along its own axis, so translating by a centre would push every
 * shell half a car forward of the boxes that trim it — which is exactly the
 * bug that made a "65 m" consist measure 69 m.
 *
 * `ExtrudeGeometry` pushes along +z, so the result is rotated into place: the
 * consist's long axis is +x at yaw 0, matching the sim's vehicle records.
 */
function bodyShell(spec: ConsistSpec, xStart: number, length: number, floorZ: number) {
  const geometry = new THREE.ExtrudeGeometry(bodyProfile(spec), {
    depth: length,
    bevelEnabled: false,
    curveSegments: 4,
  });
  // `ExtrudeGeometry` lays the shape in XY and extrudes along +Z, so a vertex
  // arrives as (profileHorizontal, profileVertical, alongCar) and has to be
  // remapped to (alongCar, profileHorizontal, profileVertical) — i.e. world
  // (x, y, z) with x along the train and z up.
  //
  // `rotateY(+90°)` alone gives (alongCar, profileVertical, −profileHorizontal),
  // which lays the car on its side and silently swaps its width and height;
  // the follow-up `rotateX(+90°)` completes the mapping. Getting this wrong
  // produced a 69 m "65 m" train whose bounding box the footprint test caught.
  geometry.rotateY(Math.PI / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(xStart, 0, floorZ);
  return geometry;
}

/** A box, positioned by its centre. */
function box(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  g.translate(x, y, z);
  return g;
}

/**
 * One merged, vertex-coloured consist. `accentHex` is the line's livery, used
 * for the waist stripe and the cab band so a train's route is readable from
 * the train itself, not only from the track under it.
 */
export function buildTrainGeometry(spec: ConsistSpec, accentHex: number): THREE.BufferGeometry {
  const accent = new THREE.Color(accentHex);
  const total = consistLengthM(spec);
  const floorZ = spec.rideHeightM;
  const halfW = spec.widthM / 2;

  // Glazing band: eye height on a real EMU, and the vertical centre of mass
  // of the silhouette, which is what the eye locks onto.
  const glassZ = floorZ + spec.heightM * 0.62;
  const glassH = spec.heightM * 0.3;
  // Livery stripe sits just under the glazing, like most Bangkok stock.
  const stripeZ = floorZ + spec.heightM * 0.36;
  const stripeH = spec.heightM * 0.16;

  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < spec.cars; i++) {
    const isLead = i === spec.cars - 1; // +x is the direction of travel
    const xStart = -total / 2 + i * (spec.carLengthM + spec.gapM);
    const bodyLength = isLead ? spec.carLengthM - spec.noseLengthM : spec.carLengthM;

    parts.push(paint(bodyShell(spec, xStart, bodyLength, floorZ), BODY));

    // Glazing down both flanks, inset a hair so it reads as glass in a recess
    // rather than as paint. Two thin boxes are far cheaper than cutting the
    // shell, and at this scale indistinguishable.
    const glassLength = bodyLength - 1.2;
    if (glassLength > 0.5) {
      const xMid = xStart + bodyLength / 2;
      for (const side of [-1, 1]) {
        parts.push(
          paint(box(glassLength, 0.12, glassH, xMid, side * (halfW - 0.03), glassZ), GLASS),
        );
      }
      for (const side of [-1, 1]) {
        parts.push(
          paint(box(bodyLength - 0.4, 0.1, stripeH, xMid, side * (halfW + 0.01), stripeZ), accent),
        );
      }
    }

    // Underframe skirt and two bogies per car. A monorail straddles its beam,
    // so it gets the skirt but no visible wheelsets.
    const xMid = xStart + bodyLength / 2;
    parts.push(
      paint(box(bodyLength - 0.6, spec.widthM - 0.5, 0.45, xMid, 0, floorZ + 0.1), UNDERFRAME),
    );
    if (spec.rideHeightM > 0.25) {
      for (const end of [-1, 1]) {
        parts.push(
          paint(
            box(2.4, spec.widthM - 0.9, spec.rideHeightM, xMid + end * (bodyLength / 2 - 2.2), 0,
              spec.rideHeightM / 2),
            UNDERFRAME,
          ),
        );
      }
    }

    // Roof equipment: one long low box, broken by the car gap, which gives the
    // roofline something to catch the light on.
    parts.push(
      paint(box(bodyLength * 0.55, spec.widthM * 0.45, 0.22, xMid, 0, floorZ + spec.heightM + 0.1),
        ROOF_KIT),
    );

    // Coupling between cars.
    if (i < spec.cars - 1) {
      parts.push(
        paint(
          box(spec.gapM + 0.2, spec.widthM * 0.55, spec.heightM * 0.5,
            xStart + spec.carLengthM + spec.gapM / 2, 0, floorZ + spec.heightM * 0.35),
          UNDERFRAME,
        ),
      );
    }

    // ---- Lead car: tapered nose + raked windscreen ------------------------
    if (isLead) {
      const noseStart = xStart + bodyLength;
      // Taper in three short slices. A true lofted nose would need a custom
      // buffer; three slices of a shrinking shell reads identically at map
      // scale and reuses the profile that is already correct.
      const slices = 3;
      for (let s = 0; s < slices; s++) {
        const t = (s + 1) / (slices + 1);
        const shrink = 1 - t * 0.42;
        const sliceSpec: ConsistSpec = {
          ...spec,
          widthM: spec.widthM * shrink,
          heightM: spec.heightM * (1 - t * 0.22),
        };
        const sliceLength = spec.noseLengthM / slices;
        parts.push(
          paint(
            bodyShell(sliceSpec, noseStart + s * sliceLength, sliceLength, floorZ),
            BODY,
          ),
        );
      }
      // Windscreen: a dark slab across the nose, tilted back.
      const screen = new THREE.BoxGeometry(0.3, spec.widthM * 0.72, spec.heightM * 0.34);
      screen.rotateY(-0.32);
      screen.translate(noseStart + spec.noseLengthM * 0.45, 0, glassZ + 0.05);
      parts.push(paint(screen, GLASS));
      // Livery band wrapping the nose tip — the strongest route cue there is,
      // because the nose is what faces you as a train approaches.
      parts.push(
        paint(
          box(0.5, spec.widthM * 0.62, spec.heightM * 0.5,
            noseStart + spec.noseLengthM - 0.2, 0, floorZ + spec.heightM * 0.34),
          accent,
        ),
      );
    }

    // Rear car gets a plain dark end so it does not read as another nose.
    if (i === 0) {
      parts.push(
        paint(
          box(0.28, spec.widthM * 0.8, spec.heightM * 0.42, xStart + 0.14, 0, glassZ - 0.1),
          GLASS,
        ),
      );
    }
  }

  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}
