import { describe, expect, it } from "vitest";
import { cameraLocalPosition, lngLatAltToLocal, ORIGIN_LNG_LAT } from "./coordinates";

const base = {
  center: { lng: ORIGIN_LNG_LAT[0], lat: ORIGIN_LNG_LAT[1] },
  zoom: 13,
  pitchDeg: 0,
  bearingDeg: 0,
  heightPx: 900,
};

describe("cameraLocalPosition", () => {
  it("sits directly over the centre when looking straight down", () => {
    const [x, y, z] = cameraLocalPosition(base);
    expect(Math.abs(x)).toBeLessThan(1);
    expect(Math.abs(y)).toBeLessThan(1);
    expect(z).toBeGreaterThan(0);
  });

  it("halves its height for each zoom level in", () => {
    const low = cameraLocalPosition({ ...base, zoom: 12 })[2];
    const high = cameraLocalPosition({ ...base, zoom: 13 })[2];
    expect(low / high).toBeCloseTo(2, 3);
  });

  it("is further away for a taller viewport", () => {
    const short = cameraLocalPosition({ ...base, heightPx: 450 })[2];
    const tall = cameraLocalPosition({ ...base, heightPx: 900 })[2];
    expect(tall / short).toBeCloseTo(2, 3);
  });

  it("swings behind the centre as the camera pitches over", () => {
    const flat = cameraLocalPosition(base);
    const pitched = cameraLocalPosition({ ...base, pitchDeg: 60 });
    // Lower, and displaced along the ground.
    expect(pitched[2]).toBeLessThan(flat[2]);
    expect(Math.hypot(pitched[0], pitched[1])).toBeGreaterThan(100);
  });

  it("pitching at bearing 0 puts the camera SOUTH of centre", () => {
    // Bearing 0 means north is up on screen and the camera looks north, so it
    // must be standing to the south. Getting this sign backwards would mirror
    // every billboard.
    const [x, y] = cameraLocalPosition({ ...base, pitchDeg: 60, bearingDeg: 0 });
    expect(y).toBeLessThan(-100);
    expect(Math.abs(x)).toBeLessThan(1);
  });

  it("bearing 90 puts the camera WEST of centre", () => {
    const [x, y] = cameraLocalPosition({ ...base, pitchDeg: 60, bearingDeg: 90 });
    expect(x).toBeLessThan(-100);
    expect(Math.abs(y)).toBeLessThan(1);
  });

  it("keeps the camera-to-centre distance constant as pitch changes", () => {
    const centre = lngLatAltToLocal([base.center.lng, base.center.lat, 0]);
    const distanceFor = (pitchDeg: number) => {
      const [x, y, z] = cameraLocalPosition({ ...base, pitchDeg });
      return Math.hypot(x - centre[0], y - centre[1], z - centre[2]);
    };
    expect(distanceFor(60)).toBeCloseTo(distanceFor(0), 3);
    expect(distanceFor(45)).toBeCloseTo(distanceFor(0), 3);
  });

  it("produces a plausible altitude for a whole-city view", () => {
    // z12.5 over Bangkok on a 900px viewport is a few kilometres up, not
    // metres and not hundreds of kilometres.
    const z = cameraLocalPosition({ ...base, zoom: 12.5 })[2];
    expect(z).toBeGreaterThan(2_000);
    expect(z).toBeLessThan(40_000);
  });
});
