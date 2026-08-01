import { describe, expect, it } from "vitest";
import { STRUCTURE_ALTITUDE_M, structureOfWay } from "./structure";

describe("structureOfWay", () => {
  it("reads a tunnel as underground", () => {
    expect(structureOfWay({ tunnel: "yes" })).toBe("underground");
    expect(structureOfWay({ tunnel: "building_passage" })).toBe("underground");
  });

  it("reads a bridge or a positive layer as elevated", () => {
    expect(structureOfWay({ bridge: "yes" })).toBe("elevated");
    expect(structureOfWay({ layer: "2" })).toBe("elevated");
  });

  it("reads a negative layer as underground even without a tunnel tag", () => {
    // Bangkok's MRT alignments are frequently tagged layer=-2 with no
    // tunnel tag on every constituent way.
    expect(structureOfWay({ layer: "-2" })).toBe("underground");
  });

  it("falls back to the line's own default when nothing says otherwise", () => {
    expect(structureOfWay({}, "atGrade")).toBe("atGrade");
    expect(structureOfWay({})).toBe("elevated");
  });

  it("lets tunnel=no override a negative layer", () => {
    expect(structureOfWay({ tunnel: "no", layer: "-1" })).toBe("elevated");
  });
});

describe("STRUCTURE_ALTITUDE_M", () => {
  it("stays inside the SRS F1.3 bands", () => {
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeGreaterThanOrEqual(12);
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeLessThanOrEqual(22);
    expect(STRUCTURE_ALTITUDE_M.atGrade).toBeCloseTo(0.5);
    expect(STRUCTURE_ALTITUDE_M.underground).toBeLessThanOrEqual(-12);
    expect(STRUCTURE_ALTITUDE_M.underground).toBeGreaterThanOrEqual(-25);
  });
});
