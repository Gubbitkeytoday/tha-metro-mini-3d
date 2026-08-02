/**
 * Solar position for the simulated clock (SRS F3.3).
 *
 * MVP 6's first pass made day/night a manual switch. The requirement is that
 * lighting is *driven by the simulated clock* — scrub to 06:00 and the sun
 * should be low in the east, scrub to 19:00 and it should be gone. That needs
 * a real sun position, not a boolean.
 *
 * This is the standard low-precision NOAA solar-position algorithm: accurate
 * to a fraction of a degree, which is far past what a shading direction needs,
 * and small enough not to be worth a dependency. Angles in degrees.
 */

const DEG = Math.PI / 180;

/** Bangkok. Latitude matters for the sun's arc; longitude sets solar noon. */
export const BANGKOK_LAT = 13.7563;
export const BANGKOK_LNG = 100.5018;

export interface SunPosition {
  /** Degrees above the horizon; negative when the sun is down. */
  altitudeDeg: number;
  /** Compass bearing of the sun, degrees clockwise from north. */
  azimuthDeg: number;
}

/**
 * Sun altitude/azimuth for a UTC instant at a given place.
 *
 * Takes epoch milliseconds rather than a Date so it can be called with the
 * sim clock directly — which is a plain number and may be hours or days away
 * from the wall clock.
 */
export function solarPosition(
  epochMs: number,
  latDeg = BANGKOK_LAT,
  lngDeg = BANGKOK_LNG,
): SunPosition {
  // Days since the J2000.0 epoch (2000-01-01 12:00 UTC).
  const d = epochMs / 86_400_000 - 10_957.5;

  // Mean longitude and mean anomaly of the sun.
  const meanLong = (280.46 + 0.9856474 * d) % 360;
  const meanAnom = ((357.528 + 0.9856003 * d) % 360) * DEG;

  // Ecliptic longitude — mean longitude plus the equation of centre.
  const eclipticLong =
    (meanLong + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * DEG;

  // Obliquity of the ecliptic, slowly decreasing.
  const obliquity = (23.439 - 0.0000004 * d) * DEG;

  // Equatorial coordinates.
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLong),
    Math.cos(eclipticLong),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLong));

  // Greenwich mean sidereal time, then the local hour angle of the sun.
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const localSiderealDeg = (gmst * 15 + lngDeg + 360) % 360;
  const hourAngle = localSiderealDeg * DEG - rightAscension;

  const lat = latDeg * DEG;
  const sinAltitude =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude)));

  // Azimuth measured clockwise from north.
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
  );

  return {
    altitudeDeg: altitude / DEG,
    azimuthDeg: (azimuth / DEG + 180) % 360,
  };
}

/**
 * Civil twilight — the sun 6° below the horizon — is the point where outdoor
 * detail stops being readable without lighting, and is the standard boundary
 * for "it is night now". Using 0° instead would flip the city to full night
 * while the sky is still bright.
 */
export const NIGHT_ALTITUDE_DEG = -6;

/** Whether the base map should be in its night colours at this sun position. */
export function isNightAt(altitudeDeg: number): boolean {
  return altitudeDeg < NIGHT_ALTITUDE_DEG;
}

/**
 * 0 at full night, 1 in full daylight, ramped across the twilight band.
 *
 * Lighting interpolates on this rather than snapping at the boundary, so
 * scrubbing through dawn is a sunrise instead of a light switch.
 */
export function daylightFactor(altitudeDeg: number): number {
  const t = (altitudeDeg - NIGHT_ALTITUDE_DEG) / (12 - NIGHT_ALTITUDE_DEG);
  return Math.max(0, Math.min(1, t));
}
