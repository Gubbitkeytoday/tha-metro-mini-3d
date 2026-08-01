import { describe, expect, it } from "vitest";
import { DECK_PROFILE, poleTransform, splitByStructure } from "./trackGeometry";
import type { TrackPoint } from "../types";

describe("deck profile by structure", () => {
  it("gives an at-grade line a shallow slab, not a viaduct box", () => {
    // A 2 m deep box at +0.5 m altitude would bury 1.5 m of deck under the
    // ground plane and z-fight with the basemap.
    expect(DECK_PROFILE.atGrade.depthM).toBeLessThan(1);
  });

  it("keeps the elevated viaduct at the MVP 1 dimensions", () => {
    expect(DECK_PROFILE.elevated.widthM).toBe(9);
    expect(DECK_PROFILE.elevated.depthM).toBe(2);
  });

  it("gives monorail-carrying structures a narrower beam than heavy rail", () => {
    expect(DECK_PROFILE.monorail.widthM).toBeLessThan(DECK_PROFILE.elevated.widthM);
  });
});

const p = (lng: number, s: TrackPoint[3]): TrackPoint => [lng, 13.7, 0, s];

describe("splitByStructure", () => {
  it("returns one run for a uniform line", () => {
    const runs = splitByStructure([p(0, "elevated"), p(1, "elevated"), p(2, "elevated")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it("splits where the structure changes", () => {
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "underground"),
      p(3, "underground"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1][3]).toBe("elevated");
    expect(runs[1][0][3]).toBe("underground");
  });

  it("overlaps runs by one point so the deck has no visible gap", () => {
    // Without the shared boundary vertex, a portal leaves a hole between the
    // last elevated sample and the first underground one.
    const runs = splitByStructure([p(0, "elevated"), p(1, "underground")]);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(2);
    expect(runs[0][1][0]).toBe(runs[1][0][0]);
  });

  it("drops a one-point run rather than emitting a degenerate curve", () => {
    // CatmullRomCurve3 throws on fewer than 2 points.
    const runs = splitByStructure([p(0, "elevated")]);
    expect(runs).toHaveLength(0);
  });
});

describe("station support poles", () => {
  it("runs from the ground down to an underground platform", () => {
    // A raw makeScale(1,1,z) with z = -18 gives a negative scale: inverted
    // face winding, so the pole renders inside-out and lights black.
    const { scaleZ, centerZ } = poleTransform(-18);
    expect(scaleZ).toBeGreaterThan(0);
    expect(centerZ).toBeCloseTo(-9);
  });

  it("runs from the ground up to an elevated deck", () => {
    const { scaleZ, centerZ } = poleTransform(15);
    expect(scaleZ).toBeCloseTo(15);
    expect(centerZ).toBeCloseTo(7.5);
  });

  it("gives an at-grade platform a stub, not a zero-height pole", () => {
    // scale 0 collapses the geometry and produces NaN normals.
    const { scaleZ } = poleTransform(0.5);
    expect(scaleZ).toBeGreaterThan(0);
  });
});
