import { describe, expect, it } from "vitest";
import { basemapTheme, mixColor, nightFactor, parseColor } from "./basemapTheme";

/** Relative luminance (simple perceptual weighting) from a "#rrggbb" string. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

describe("nightFactor", () => {
  it("is 0 (full day) when the sun is high", () => {
    expect(nightFactor(60)).toBe(0);
  });

  it("is 1 (full night) when the sun is well below the horizon", () => {
    expect(nightFactor(-20)).toBe(1);
  });

  it("is strictly between 0 and 1 through civil twilight", () => {
    const dusk = nightFactor(0);
    const laterDusk = nightFactor(-6);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(laterDusk).toBeGreaterThan(0);
    expect(laterDusk).toBeLessThan(1);
  });

  it("is monotonic non-increasing as elevation rises", () => {
    const samples = [-30, -20, -10, -8, -6, -3, 0, 3, 6, 10, 30, 60, 89];
    for (let i = 1; i < samples.length; i++) {
      expect(nightFactor(samples[i])).toBeLessThanOrEqual(nightFactor(samples[i - 1]));
    }
  });

  it("is deterministic", () => {
    expect(nightFactor(-4)).toBe(nightFactor(-4));
  });
});

describe("basemapTheme", () => {
  it("returns a different background at night than at midday", () => {
    expect(basemapTheme(-20).background).not.toBe(basemapTheme(60).background);
  });

  it("is genuinely darker at night, not merely a different string", () => {
    const night = basemapTheme(-20);
    const day = basemapTheme(60);
    expect(luminance(night.background)).toBeLessThan(luminance(day.background));
    expect(luminance(night.water)).toBeLessThan(luminance(day.water));
    expect(luminance(night.land)).toBeLessThan(luminance(day.land));
    expect(luminance(night.building)).toBeLessThan(luminance(day.building));
    expect(luminance(night.road)).toBeLessThan(luminance(day.road));
  });

  it("stays legible at deep night — label text is not pitch black", () => {
    const night = basemapTheme(-40);
    expect(luminance(night.labelText)).toBeGreaterThan(80);
  });

  it("every colour is a valid #rrggbb string MapLibre will accept", () => {
    const theme = basemapTheme(-15);
    for (const value of Object.values(theme)) {
      expect(value).toMatch(HEX_RE);
    }
  });

  it("is deterministic", () => {
    expect(basemapTheme(-10)).toEqual(basemapTheme(-10));
  });
});

// The real Liberty style's paint properties use hex, rgb()/rgba() and
// hsl()/hsla() flat colours (verified against the live style JSON), plus
// expressions/stop-functions which never reach parseColor as strings at
// all. mixColor must handle every flat form without throwing.
describe("parseColor", () => {
  it("parses 3- and 6-digit hex", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#f8f4f0")).toEqual({ r: 0xf8, g: 0xf4, b: 0xf0, a: 1 });
  });

  it("parses rgb() and rgba()", () => {
    expect(parseColor("rgba(255, 255, 255, 0.7)")).toEqual({ r: 255, g: 255, b: 255, a: 0.7 });
    expect(parseColor("rgb(176, 213, 154)")).toEqual({ r: 176, g: 213, b: 154, a: 1 });
  });

  it("parses hsl() and hsla()", () => {
    const c = parseColor("hsl(35, 8%, 85%)")!;
    // hsl(35, 8%, 85%) -> rgb(~219.81, ~217.26, ~213.69), independently
    // worked out from the standard HSL->RGB conversion.
    expect(c.r).toBeCloseTo(219.81, 1);
    expect(c.g).toBeCloseTo(217.26, 1);
    expect(c.b).toBeCloseTo(213.69, 1);
    expect(c.a).toBe(1);
  });

  it("returns null for anything it does not recognise", () => {
    expect(parseColor("papayawhip")).toBeNull();
    expect(parseColor("not-a-colour")).toBeNull();
  });
});

describe("mixColor", () => {
  it("at t=0 returns exactly the original colour, preserving alpha", () => {
    expect(mixColor("rgba(255, 255, 255, 0.7)", "#0a1220", 0)).toBe("rgba(255, 255, 255, 0.7)");
  });

  it("at t=1 takes the target's hue but keeps the original's alpha", () => {
    expect(mixColor("rgba(255, 255, 255, 0.7)", "#0a1220", 1)).toBe("rgba(10, 18, 32, 0.7)");
  });

  it("never writes an opacity property — it stays a colour string throughout", () => {
    // No literal 'opacity' key anywhere in the output shape; alpha travels
    // only inside the colour string itself, same as the input did.
    const out = mixColor("#ffffff", "#0a1220", 0.5);
    expect(out).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("recomputing twice from the same original is stable (no compounding)", () => {
    const original = "#f8f4f0";
    const first = mixColor(original, "#0a1220", 0.5);
    const second = mixColor(original, "#0a1220", 0.5);
    expect(first).toBe(second);
  });
});
