import { describe, expect, it } from "vitest";
import { buildTrainGeometry, consistLengthM, CONSISTS } from "./vehicleModels";

describe("consist specs", () => {
  it("keeps the MVP 3 heavy-rail train at 65 m over 4 cars", () => {
    expect(CONSISTS.heavy.cars).toBe(4);
    expect(consistLengthM(CONSISTS.heavy)).toBeCloseTo(65, 1);
  });

  it("makes the Gold Line APM the shortest consist", () => {
    const lengths = Object.values(CONSISTS).map(consistLengthM);
    expect(consistLengthM(CONSISTS.apm)).toBe(Math.min(...lengths));
  });

  it("makes monorail cars narrower than heavy rail", () => {
    expect(CONSISTS.monorail.widthM).toBeLessThan(CONSISTS.heavy.widthM);
  });

  it("builds one merged geometry with a vertex colour per vertex", () => {
    const geo = buildTrainGeometry(CONSISTS.monorail, 0xff69b4);
    const positions = geo.getAttribute("position").count;
    expect(geo.getAttribute("color").count).toBe(positions);
  });
});
