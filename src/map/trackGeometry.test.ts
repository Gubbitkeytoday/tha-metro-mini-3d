import { describe, expect, it } from "vitest";
import { DECK_PROFILE, structureRuns } from "./trackGeometry";
import type { LineGeometry, Structure } from "../types";

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

function line(structures: Structure[] | undefined, nominal: Structure = "elevated"): LineGeometry {
  return {
    key: "test",
    name: "Test",
    nameTh: "ทดสอบ",
    color: "#123456",
    structure: nominal,
    vehicleType: "heavy",
    gtfsRouteId: "1",
    relationId: 1,
    osmName: "test",
    track: (structures ?? [nominal, nominal]).map((_, i) => [100.5 + i * 1e-4, 13.75, 0]),
    trackStructures: structures as Structure[],
    stations: [],
  };
}

describe("structureRuns", () => {
  it("returns one run for a uniform line", () => {
    const runs = structureRuns(line(["elevated", "elevated", "elevated"]));
    expect(runs).toEqual([{ structure: "elevated", from: 0, to: 2 }]);
  });

  it("splits a mixed line at each structure change", () => {
    // The MRT Blue shape: viaduct, tunnel core, viaduct.
    const runs = structureRuns(
      line([
        "elevated", "elevated",
        "underground", "underground", "underground",
        "elevated", "elevated",
      ]),
    );
    expect(runs.map((r) => r.structure)).toEqual(["elevated", "underground", "elevated"]);
  });

  it("makes adjacent runs share their boundary point so decks meet", () => {
    const runs = structureRuns(line(["elevated", "elevated", "underground", "underground"]));
    expect(runs[0].to).toBe(runs[1].from);
  });

  it("covers the whole track from first point to last", () => {
    const runs = structureRuns(line(["elevated", "underground", "underground", "atGrade"]));
    expect(runs[0].from).toBe(0);
    expect(runs[runs.length - 1].to).toBe(3);
  });

  it("falls back to a single nominal run when trackStructures is absent", () => {
    // Data written before MVP 6 must keep rendering, not throw.
    const runs = structureRuns(line(undefined, "elevated"));
    expect(runs).toEqual([{ structure: "elevated", from: 0, to: 1 }]);
  });

  it("falls back when trackStructures length disagrees with track length", () => {
    const l = line(["elevated", "elevated", "elevated"]);
    l.trackStructures = ["underground"];
    expect(structureRuns(l)).toEqual([{ structure: "elevated", from: 0, to: 2 }]);
  });

  it("emits nothing for a track too short to sweep", () => {
    const l = line(["elevated"]);
    l.track = [[100.5, 13.75, 0]];
    expect(structureRuns(l)).toEqual([]);
  });
});
