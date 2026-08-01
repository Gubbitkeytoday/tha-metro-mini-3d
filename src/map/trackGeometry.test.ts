import { describe, expect, it } from "vitest";
import { DECK_PROFILE } from "./trackGeometry";

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
