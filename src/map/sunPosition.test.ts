import { describe, expect, it } from "vitest";
import {
  BANGKOK_LAT,
  BANGKOK_LNG,
  daylightFactor,
  isNightAt,
  solarPosition,
} from "./sunPosition";

/** Bangkok is UTC+7 with no DST, so local time is a fixed offset. */
function bangkok(dateIso: string, hour: number, minute = 0): number {
  return Date.parse(`${dateIso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`);
}

describe("solarPosition over a Bangkok day", () => {
  // An equinox: the sun rises near due east and sets near due west anywhere.
  const equinox = "2026-03-20";

  it("puts the sun below the horizon before dawn", () => {
    expect(solarPosition(bangkok(equinox, 3)).altitudeDeg).toBeLessThan(-10);
  });

  it("puts the sun high at local noon", () => {
    const { altitudeDeg } = solarPosition(bangkok(equinox, 12, 20));
    // Bangkok is 13.76°N, so at the equinox the noon sun is ~76° up.
    expect(altitudeDeg).toBeGreaterThan(70);
    expect(altitudeDeg).toBeLessThanOrEqual(90);
  });

  it("puts the sun below the horizon after dusk", () => {
    expect(solarPosition(bangkok(equinox, 21)).altitudeDeg).toBeLessThan(-10);
  });

  it("rises in the east and sets in the west", () => {
    // Azimuth is clockwise from north: ~90° is east, ~270° is west.
    const morning = solarPosition(bangkok(equinox, 8));
    const afternoon = solarPosition(bangkok(equinox, 16));
    expect(morning.altitudeDeg).toBeGreaterThan(0);
    expect(afternoon.altitudeDeg).toBeGreaterThan(0);
    expect(morning.azimuthDeg).toBeGreaterThan(60);
    expect(morning.azimuthDeg).toBeLessThan(120);
    expect(afternoon.azimuthDeg).toBeGreaterThan(240);
    expect(afternoon.azimuthDeg).toBeLessThan(300);
  });

  it("crosses the horizon near the real sunrise and sunset times", () => {
    // Bangkok's equinox sunrise/sunset are about 06:24 and 18:32 local.
    expect(solarPosition(bangkok(equinox, 6, 0)).altitudeDeg).toBeLessThan(0);
    expect(solarPosition(bangkok(equinox, 7, 0)).altitudeDeg).toBeGreaterThan(0);
    expect(solarPosition(bangkok(equinox, 18, 0)).altitudeDeg).toBeGreaterThan(0);
    expect(solarPosition(bangkok(equinox, 19, 0)).altitudeDeg).toBeLessThan(0);
  });

  it("puts the June sun north of overhead and the December sun south", () => {
    // Bangkok sits inside the tropics, so the noon sun swaps sides over the
    // year — a good check that declination is actually being applied.
    const june = solarPosition(bangkok("2026-06-21", 12, 20));
    const december = solarPosition(bangkok("2026-12-21", 12, 20));
    expect(june.azimuthDeg).toBeGreaterThan(270);
    expect(december.azimuthDeg).toBeGreaterThan(150);
    expect(december.azimuthDeg).toBeLessThan(210);
  });

  it("is not fooled by longitude — solar noon shifts with it", () => {
    const noonHere = solarPosition(bangkok("2026-03-20", 12, 20), BANGKOK_LAT, BANGKOK_LNG);
    const sameInstant15DegWest = solarPosition(
      bangkok("2026-03-20", 12, 20),
      BANGKOK_LAT,
      BANGKOK_LNG - 15,
    );
    // 15° of longitude is an hour of rotation, so the sun is lower there.
    expect(sameInstant15DegWest.altitudeDeg).toBeLessThan(noonHere.altitudeDeg);
  });
});

describe("isNightAt", () => {
  it("treats civil twilight as the boundary, not the horizon", () => {
    expect(isNightAt(-1)).toBe(false);
    expect(isNightAt(-5.9)).toBe(false);
    expect(isNightAt(-6.1)).toBe(true);
  });
});

describe("daylightFactor", () => {
  it("is 0 at night and 1 in full day", () => {
    expect(daylightFactor(-30)).toBe(0);
    expect(daylightFactor(60)).toBe(1);
  });

  it("ramps rather than snapping through twilight", () => {
    const dawn = daylightFactor(0);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
    expect(daylightFactor(6)).toBeGreaterThan(dawn);
  });

  it("is monotonic", () => {
    let previous = -1;
    for (let alt = -20; alt <= 40; alt += 2) {
      const f = daylightFactor(alt);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });
});
