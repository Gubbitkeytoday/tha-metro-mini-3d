/**
 * Day/night theming for the MapLibre basemap itself (Task 10b). `sun.ts`'s
 * `skyPalette` already re-lights the Three.js track/train layer from the sim
 * clock; this module answers the human-added ask that the *city* also read
 * as night, by re-colouring the basemap's own paint properties.
 *
 * Pure module, same discipline as `sun.ts`: no Three, no MapLibre, no DOM,
 * no clock reads. `MapContainer.tsx` owns capturing each layer's original
 * colour (once, at `style.load`) and blending it toward the value this
 * module returns — this module never sees the live style.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Above this solar elevation the map is full day (nightFactor = 0); below
// this it is full night (nightFactor = 1); smoothstep between, so scrubbing
// the clock through dusk/dawn is a continuous fade, not a pop.
const DAY_ELEVATION_DEG = 3;
const NIGHT_ELEVATION_DEG = -8;

/** 0 = full day, 1 = full night. Monotonic non-increasing in elevation. */
export function nightFactor(elevationDeg: number): number {
  const p = clamp01(
    (DAY_ELEVATION_DEG - elevationDeg) / (DAY_ELEVATION_DEG - NIGHT_ELEVATION_DEG),
  );
  // Same 3p^2 - 2p^3 ease the motion model uses elsewhere (SRS §F2.2), so a
  // dusk fade shares its acceleration curve with everything else that eases.
  return p * p * (3 - 2 * p);
}

export interface BasemapTheme {
  background: string;
  water: string;
  land: string;
  building: string;
  road: string;
  labelText: string;
  labelHalo: string;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const DAY: Record<keyof BasemapTheme, RgbColor> = {
  background: { r: 0xf8, g: 0xf4, b: 0xf0 },
  water: { r: 0xaa, g: 0xd3, b: 0xdf },
  land: { r: 0xf2, g: 0xef, b: 0xe9 },
  building: { r: 0xd9, g: 0xd0, b: 0xc9 },
  road: { r: 0xff, g: 0xff, b: 0xff },
  labelText: { r: 0x33, g: 0x33, b: 0x33 },
  labelHalo: { r: 0xff, g: 0xff, b: 0xff },
};

// Deliberately not pitch black — same "still legible at 03:00" position
// `skyPalette` takes (`skyPalette(-40).ambientIntensity > 0.2`). Night is a
// deep, cool, uniform wash; label text stays light so it still reads.
const NIGHT: Record<keyof BasemapTheme, RgbColor> = {
  background: { r: 0x0a, g: 0x12, b: 0x20 },
  water: { r: 0x0d, g: 0x2b, b: 0x4a },
  land: { r: 0x14, g: 0x18, b: 0x1f },
  building: { r: 0x1c, g: 0x22, b: 0x2c },
  road: { r: 0x3a, g: 0x42, b: 0x50 },
  labelText: { r: 0xd8, g: 0xe2, b: 0xf0 },
  labelHalo: { r: 0x0a, g: 0x12, b: 0x20 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const toHex = (c: RgbColor): string => {
  const ch = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
};

const mixRgb = (a: RgbColor, b: RgbColor, t: number): RgbColor => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});

/**
 * The basemap's target colour palette for a given solar elevation — a
 * self-contained blend between a generic day reference and a generic night
 * reference per role. Callers with a real layer's own original colour (as
 * `MapContainer.tsx` has, captured once at `style.load`) should blend
 * *that* toward this theme's value with `mixColor`, not use this palette
 * verbatim, so daytime stays pixel-identical to the untouched style.
 */
export function basemapTheme(elevationDeg: number): BasemapTheme {
  const t = nightFactor(elevationDeg);
  const roles = Object.keys(DAY) as (keyof BasemapTheme)[];
  const theme = {} as BasemapTheme;
  for (const role of roles) {
    theme[role] = toHex(mixRgb(DAY[role], NIGHT[role], t));
  }
  return theme;
}

interface RgbaColor extends RgbColor {
  a: number;
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  // h in degrees, s and l in [0, 1].
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

const HEX3_RE = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse a CSS colour string (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/
 * `rgba()`, `hsl()`/`hsla()` — every flat form the Liberty style actually
 * uses) into RGBA. Returns `null` for anything else, including MapLibre
 * expressions/stop-functions (which arrive as arrays or objects, never
 * strings, so those never even reach this function) and any CSS colour
 * syntax outside the forms above (e.g. named colours) — callers should
 * treat `null` the same as an expression: skip and count it.
 */
export function parseColor(input: string): RgbaColor | null {
  const s = input.trim();
  let m = HEX3_RE.exec(s);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = HEX8_RE.exec(s);
  if (m) {
    return {
      r: parseInt(m[1], 16),
      g: parseInt(m[2], 16),
      b: parseInt(m[3], 16),
      a: parseInt(m[4], 16) / 255,
    };
  }
  m = HEX6_RE.exec(s);
  if (m) {
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
  }
  m = RGB_RE.exec(s);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  m = HSL_RE.exec(s);
  if (m) {
    const { r, g, b } = hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
    return { r, g, b, a: m[4] !== undefined ? Number(m[4]) : 1 };
  }
  return null;
}

const toCss = (c: RgbaColor): string => {
  if (c.a >= 1) return toHex(c);
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  const a = Math.round(clamp01(c.a) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/**
 * Blend a real CSS colour (any form `parseColor` accepts) toward another
 * such colour by `t` (0 = `from` unchanged, 1 = `to`). The caller must
 * always pass the layer's *original* colour as `from` — blending from a
 * previously-blended result compounds every call and drifts the whole map
 * to black. `from`'s alpha is preserved unchanged (a translucent halo stays
 * translucent); only hue/lightness move toward `to`, whose alpha `mixColor`
 * ignores (this module's own night palette is always opaque — day/night is
 * a colour choice, not an opacity one; `*-opacity` paint properties belong
 * to Task 7's underground mode, not this module).
 *
 * Throws if either colour is not one `parseColor` recognises — callers
 * should have already filtered with `parseColor` at classification time,
 * so this should never fire in practice.
 */
export function mixColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a) throw new Error(`unsupported colour: ${from}`);
  if (!b) throw new Error(`unsupported colour: ${to}`);
  const clamped = clamp01(t);
  return toCss({
    r: lerp(a.r, b.r, clamped),
    g: lerp(a.g, b.g, clamped),
    b: lerp(a.b, b.b, clamped),
    a: a.a,
  });
}
