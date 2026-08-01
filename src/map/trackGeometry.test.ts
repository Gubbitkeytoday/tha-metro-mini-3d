import { describe, expect, it } from "vitest";
import { DECK_PROFILE, buildTrackDeck, poleTransform, splitByStructure } from "./trackGeometry";
import type { LineGeometry, TrackPoint } from "../types";

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

// Regression coverage for a review round-1 finding: a run that changes
// structure at the very first or very last vertex of the track. Both
// findings below were only visible with a run that had a genuine,
// non-degenerate neighbour to borrow from (unlike the 2-point case above,
// where every solution is forced to self-duplicate somewhere).
describe("splitByStructure — boundary vertex at the very start/end (regression)", () => {
  it("shares a genuine boundary vertex for a trailing single-point run", () => {
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "elevated"),
      p(3, "underground"),
    ]);
    expect(runs).toHaveLength(2);
    // The shared vertex must be the true predecessor's own last point (e2,
    // lng 2) — not some other point that happened to be lying around.
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[1][0][0]).toBe(2);
  });

  it("shares a genuine boundary vertex for a leading single-point run", () => {
    const runs = splitByStructure([
      p(0, "underground"),
      p(1, "elevated"),
      p(2, "elevated"),
      p(3, "elevated"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[0].at(-1)?.[0]).toBe(1);
  });

  it("does not read a sibling run's already-borrowed point (regression for review finding 2)", () => {
    // A left-to-right padding pass pads the elevated run first (forward-
    // borrowing the underground run's point), then the underground run's
    // own backward-borrow reads that ALREADY-MUTATED elevated run instead
    // of its true original last point — producing self-duplicate [u1, u1]
    // rather than the genuine two-point [e0, u1] overlap. This is the
    // pathological 2-point case (see "overlaps runs by one point" above),
    // where no solution can avoid self-duplication entirely — but which run
    // ends up degenerate is not arbitrary: it must be the run that has
    // nothing on its own OTHER side to borrow from instead (here, run 0,
    // the very first run in the whole track). The run that legitimately
    // represents the boundary vertex — run 1 here — must come out clean.
    const runs = splitByStructure([p(0, "elevated"), p(1, "underground")]);
    expect(runs[1][0]).not.toEqual(runs[1][1]);
  });
});

describe("buildTrackDeck structure labelling (regression)", () => {
  const line = (track: TrackPoint[]): LineGeometry => ({
    key: "test",
    name: "Test Line",
    nameTh: "สายทดสอบ",
    color: "#ff0000",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: null,
    preRevenue: false,
    relationId: 0,
    osmName: "test",
    track,
    stations: [],
  });

  it("labels a trailing single-point run with its OWN structure, not its predecessor's borrowed point", () => {
    const group = buildTrackDeck(
      line([p(0, "elevated"), p(1, "elevated"), p(2, "elevated"), p(3, "underground")]),
    );
    expect(group.children).toHaveLength(2);
    expect(group.children[0].userData.structure).toBe("elevated");
    expect(group.children[1].userData.structure).toBe("underground");
  });

  it("labels a leading single-point run with its OWN structure", () => {
    const group = buildTrackDeck(
      line([p(0, "underground"), p(1, "elevated"), p(2, "elevated"), p(3, "elevated")]),
    );
    expect(group.children).toHaveLength(2);
    expect(group.children[0].userData.structure).toBe("underground");
    expect(group.children[1].userData.structure).toBe("elevated");
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
