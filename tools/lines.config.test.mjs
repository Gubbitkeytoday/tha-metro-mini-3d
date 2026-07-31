import { describe, expect, it } from "vitest";
import { assertRegistryValid, LINES, STRUCTURE_ALTITUDE_M } from "./lines.config.mjs";

describe("line registry", () => {
  it("is internally consistent", () => {
    expect(() => assertRegistryValid()).not.toThrow();
  });

  it("still starts with Sukhumvit then Silom", () => {
    // route_idx 0/1 are baked into the committed cache and every screenshot.
    expect(LINES[0].key).toBe("sukhumvit");
    expect(LINES[1].key).toBe("silom");
  });

  it("rejects a duplicate GTFS route id", () => {
    const dup = [LINES[0], { ...LINES[1], gtfsRouteId: LINES[0].gtfsRouteId }];
    expect(() => assertRegistryValid(dup)).toThrow(/duplicate gtfsRouteId/);
  });

  it("rejects an unknown structure", () => {
    const bad = [{ ...LINES[0], structure: "floating" }];
    expect(() => assertRegistryValid(bad)).toThrow(/unknown structure/);
  });

  it("prices every structure the SRS defines", () => {
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeGreaterThanOrEqual(12);
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeLessThanOrEqual(22);
    expect(STRUCTURE_ALTITUDE_M.atGrade).toBeGreaterThan(0);
    expect(STRUCTURE_ALTITUDE_M.underground).toBeLessThanOrEqual(-12);
  });
});
