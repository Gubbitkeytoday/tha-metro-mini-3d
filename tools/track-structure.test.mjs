import { describe, expect, it } from "vitest";
import {
  densifyAroundTransitions,
  deriveStructure,
  smoothAltitudes,
} from "./track-structure.mjs";

describe("deriveStructure", () => {
  it("reads tunnel and bridge tags as the structure", () => {
    expect(deriveStructure({ tunnel: "yes" }, "elevated")).toBe("underground");
    expect(deriveStructure({ tunnel: "building_passage" }, "elevated")).toBe("underground");
    expect(deriveStructure({ bridge: "yes" }, "underground")).toBe("elevated");
    expect(deriveStructure({ bridge: "viaduct" }, "underground")).toBe("elevated");
  });

  it("falls back to the line's nominal structure when untagged", () => {
    expect(deriveStructure({}, "elevated")).toBe("elevated");
    expect(deriveStructure({ railway: "subway" }, "underground")).toBe("underground");
    expect(deriveStructure(undefined, "elevated")).toBe("elevated");
  });

  it("treats an explicit tunnel=no bridge=no pair as at-grade", () => {
    expect(deriveStructure({ tunnel: "no", bridge: "no" }, "elevated")).toBe("atGrade");
  });

  it("does not read covered=yes as underground", () => {
    // covered marks a roofed but surface-level alignment, not a tunnel.
    expect(deriveStructure({ covered: "yes" }, "elevated")).toBe("elevated");
  });

  it("prefers tunnel over a contradictory bridge tag", () => {
    expect(deriveStructure({ tunnel: "yes", bridge: "yes" }, "elevated")).toBe("underground");
  });
});

/** ~10 m of longitude at Bangkok's latitude, so a 40-point line spans ~400 m. */
const STEP_LON = 0.0001;

function line(altitudes) {
  return altitudes.map((alt, i) => [100.5 + i * STEP_LON, 13.75, alt]);
}

describe("smoothAltitudes", () => {
  it("leaves a uniform-altitude line untouched", () => {
    const input = line(Array(40).fill(15));
    const out = smoothAltitudes(input);
    for (const [, , alt] of out) expect(alt).toBeCloseTo(15, 6);
  });

  it("never moves lon/lat", () => {
    const input = line([15, 15, -18, -18, 15, 15]);
    const out = smoothAltitudes(input);
    out.forEach(([lon, lat], i) => {
      expect(lon).toBe(input[i][0]);
      expect(lat).toBe(input[i][1]);
    });
  });

  it("turns a portal step into a monotonic ramp", () => {
    // 60 points: 30 elevated then 30 underground, ~11 m apart.
    const input = line([...Array(30).fill(15), ...Array(30).fill(-18)]);
    const out = smoothAltitudes(input).map(([, , alt]) => alt);
    // No two consecutive points may jump the full 33 m step any more.
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(33);
    }
    // Descending throughout, and still reaching both extremes at the ends.
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThanOrEqual(out[i - 1] + 1e-9);
    expect(out[0]).toBeCloseTo(15, 3);
    expect(out[out.length - 1]).toBeCloseTo(-18, 3);
  });

  it("keeps a long tunnel at full depth in its middle", () => {
    const input = line([...Array(10).fill(15), ...Array(120).fill(-18), ...Array(10).fill(15)]);
    const out = smoothAltitudes(input).map(([, , alt]) => alt);
    expect(out[70]).toBeCloseTo(-18, 3);
  });

  it("softens a stub tunnel run instead of plunging it", () => {
    // 3 tunnel points inside a long viaduct — the ARL/SRT Red case.
    const input = line([...Array(40).fill(15), -18, -18, -18, ...Array(40).fill(15)]);
    const out = smoothAltitudes(input).map(([, , alt]) => alt);
    const deepest = Math.min(...out);
    expect(deepest).toBeGreaterThan(-18);
    expect(deepest).toBeLessThan(15);
  });

  it("returns short paths unchanged", () => {
    const input = line([15, -18]);
    expect(smoothAltitudes(input)).toEqual(input);
  });
});

/** ~95 m apart — MRT Blue's real average OSM point spacing. */
const SPARSE_LON = 0.00088;

function sparse(structures) {
  return structures.map((s, i) => [100.5 + i * SPARSE_LON, 13.75, s]);
}

const ALT = { elevated: 15, underground: -18, atGrade: 0.5 };
const toAltitudes = (path) => path.map(([lon, lat, s]) => [lon, lat, ALT[s]]);

describe("densifyAroundTransitions", () => {
  it("adds no points at all to a uniform line", () => {
    const input = sparse(Array(20).fill("elevated"));
    expect(densifyAroundTransitions(input)).toEqual(input);
  });

  it("inserts points around a transition on sparse geometry", () => {
    const input = sparse([...Array(10).fill("elevated"), ...Array(10).fill("underground")]);
    const out = densifyAroundTransitions(input);
    expect(out.length).toBeGreaterThan(input.length);
  });

  it("only densifies near the transition, not the whole line", () => {
    const input = sparse([...Array(60).fill("elevated"), ...Array(60).fill("underground")]);
    const out = densifyAroundTransitions(input);
    // A 220 m ramp at 20 m spacing is roughly a dozen inserted points; it must
    // not approach a full resample of a ~11 km line.
    expect(out.length - input.length).toBeLessThan(40);
  });

  it("keeps every original point, in order", () => {
    const input = sparse([...Array(5).fill("elevated"), ...Array(5).fill("underground")]);
    const out = densifyAroundTransitions(input);
    let cursor = 0;
    for (const original of input) {
      const found = out.indexOf(original, cursor);
      expect(found).toBeGreaterThanOrEqual(0);
      cursor = found + 1;
    }
  });

  it("labels inserted points with a real structure from one side or the other", () => {
    const input = sparse([...Array(5).fill("elevated"), ...Array(5).fill("underground")]);
    for (const [, , s] of densifyAroundTransitions(input)) {
      expect(["elevated", "underground"]).toContain(s);
    }
  });

  it("densify then smooth removes the cliff that smoothing alone cannot", () => {
    // The bug this pair exists for: on ~95 m spacing the smoothing window
    // holds barely two points, so smoothing alone leaves the full 33 m step.
    const structures = [...Array(20).fill("elevated"), ...Array(20).fill("underground")];
    const step = (path) => {
      let worst = 0;
      for (let i = 1; i < path.length; i++) {
        worst = Math.max(worst, Math.abs(path[i][2] - path[i - 1][2]));
      }
      return worst;
    };

    const smoothedOnly = smoothAltitudes(toAltitudes(sparse(structures)));
    const densifiedThenSmoothed = smoothAltitudes(
      toAltitudes(densifyAroundTransitions(sparse(structures))),
    );

    expect(step(smoothedOnly)).toBeGreaterThan(20);
    expect(step(densifiedThenSmoothed)).toBeLessThan(6);
  });
});
