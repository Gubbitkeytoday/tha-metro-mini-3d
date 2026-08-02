import { describe, expect, it } from "vitest";
import { LABEL_FADE, labelOpacity } from "./stationLabels";

describe("labelOpacity", () => {
  const { nearOut, nearIn, farIn, farOut } = LABEL_FADE;

  it("is invisible when you are practically inside the label", () => {
    expect(labelOpacity(0)).toBe(0);
    expect(labelOpacity(nearOut)).toBe(0);
  });

  it("is invisible beyond the far cut", () => {
    expect(labelOpacity(farOut)).toBe(0);
    expect(labelOpacity(farOut * 2)).toBe(0);
  });

  it("is fully opaque across the whole working range", () => {
    expect(labelOpacity(nearIn)).toBe(1);
    expect(labelOpacity(5_000)).toBe(1);
    expect(labelOpacity(30_000)).toBe(1);
    expect(labelOpacity(farIn)).toBe(1);
  });

  it("ramps rather than popping at both ends", () => {
    const nearMid = labelOpacity((nearOut + nearIn) / 2);
    const farMid = labelOpacity((farIn + farOut) / 2);
    expect(nearMid).toBeGreaterThan(0);
    expect(nearMid).toBeLessThan(1);
    expect(farMid).toBeGreaterThan(0);
    expect(farMid).toBeLessThan(1);
  });

  it("never returns a value outside 0..1", () => {
    for (let d = 0; d < farOut * 1.5; d += 137) {
      const o = labelOpacity(d);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });

  it("stays visible at the altitude of a whole-region view", () => {
    // The "before you jump" camera sits tens of km up; labels must survive it,
    // because that is precisely the view they exist for. An earlier 16 km far
    // cut made every label vanish exactly there.
    expect(labelOpacity(20_000)).toBe(1);
    expect(labelOpacity(50_000)).toBe(1);
  });
});
