import { describe, expect, it } from "vitest";
import { darken, parseColor } from "./dayNight";

describe("parseColor", () => {
  it("reads the hex forms MapLibre styles use", () => {
    expect(parseColor("#ffffff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#000")).toEqual([0, 0, 0, 1]);
    expect(parseColor("#1964B7")).toEqual([25, 100, 183, 1]);
  });

  it("reads rgb() and rgba(), keeping alpha", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30, 1]);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
  });

  it("reads hsl()", () => {
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual([255, 0, 0, 1]);
    expect(parseColor("hsl(120, 100%, 50%)")).toEqual([0, 255, 0, 1]);
  });

  it("returns null for anything it cannot parse rather than guessing", () => {
    // A data expression, a named colour, a missing property — all must be
    // left untouched, not silently replaced with a wrong colour.
    expect(parseColor(["interpolate", ["linear"], ["zoom"], 8, "#fff"])).toBeNull();
    expect(parseColor("papayawhip")).toBeNull();
    expect(parseColor(undefined)).toBeNull();
    expect(parseColor(42)).toBeNull();
  });
});

describe("darken", () => {
  it("moves a colour toward the night tint", () => {
    const out = parseColor(darken("#ffffff", 1));
    // amount 1 lands exactly on the tint.
    expect(out?.slice(0, 3)).toEqual([12, 18, 38]);
  });

  it("leaves a colour alone at amount 0", () => {
    expect(parseColor(darken("#804020", 0))?.slice(0, 3)).toEqual([128, 64, 32]);
  });

  it("preserves alpha", () => {
    expect(parseColor(darken("rgba(200, 200, 200, 0.25)", 0.5))?.[3]).toBe(0.25);
  });

  it("passes through unparseable values as null so the caller skips them", () => {
    expect(darken(["case", true, "#fff", "#000"], 0.8)).toBeNull();
  });

  it("always darkens a bright colour", () => {
    const before = parseColor("#f0f0f0")!;
    const after = parseColor(darken("#f0f0f0", 0.7))!;
    expect(after[0]).toBeLessThan(before[0]);
    expect(after[1]).toBeLessThan(before[1]);
    expect(after[2]).toBeLessThan(before[2]);
  });
});
