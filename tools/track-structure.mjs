/**
 * Pure geometry helpers shared by the Overpass fetcher and its unit tests.
 *
 * These live outside tools/fetch-network.mjs so they can be imported without
 * dragging in that file: it is a CLI with a `#!` shebang, which Vite cannot
 * parse as a module, and a main() that would fire a full Overpass run on
 * import.
 */

/**
 * Classify one OSM way as underground / elevated / at-grade from its tags.
 *
 * This is what makes a mixed-structure line (MRT Blue: bored tunnel through
 * the core, viaduct on both outer arms) render at the right altitude per
 * segment instead of one nominal height for the whole route — SRS §F1.3's
 * altitude-by-structure rule applied at the granularity OSM actually has it.
 *
 * `tunnel` and `bridge` are OSM's own load-bearing tags for exactly this, so
 * they are the source of truth rather than anything inferred from geography.
 * `covered=yes` is deliberately NOT treated as underground — it marks a roofed
 * but surface-level alignment. A way carrying neither tag falls back to the
 * registry line's nominal `structure`, which is why every existing (uniformly
 * elevated) line keeps rendering exactly as it did before MVP 6.
 */
export function deriveStructure(tags, fallback) {
  if (!tags) return fallback;
  const no = (v) => v === undefined || v === "no";
  if (!no(tags.tunnel)) return "underground";
  if (!no(tags.bridge)) return "elevated";
  // An explicit negative on both ("tunnel=no bridge=no") is a mapper stating
  // the alignment is on the ground — stronger than the line's nominal value.
  if (tags.tunnel === "no" && tags.bridge === "no") return "atGrade";
  return fallback;
}

/**
 * Length of the ramp smoothed in at every structure change, in metres.
 *
 * Without this, a portal is a cliff: consecutive track points 20 m apart jump
 * the full 33 m between tunnel (−18) and viaduct (+15), so the deck draws a
 * vertical wall and a train crossing it teleports between altitudes in one
 * frame. Real portals descend over a couple of hundred metres of ramp; 220 m
 * at a ~3 % grade is about right for heavy metro and is short enough that the
 * mid-tunnel and mid-viaduct altitudes are still reached exactly.
 */
const PORTAL_RAMP_M = 220;

/** Metres per degree of latitude — good enough to weight a local ramp. */
const M_PER_DEG_LAT = 111_320;

/** Target point spacing inside a ramp. */
const RAMP_SPACING_M = 20;

/** Along-path cumulative distance in metres for a [lon, lat, ...] polyline. */
function cumulativeMetres(path) {
  const dist = [0];
  for (let i = 1; i < path.length; i++) {
    const [lon0, lat0] = path[i - 1];
    const [lon1, lat1] = path[i];
    const dLat = (lat1 - lat0) * M_PER_DEG_LAT;
    const dLon = (lon1 - lon0) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
    dist.push(dist[i - 1] + Math.hypot(dLat, dLon));
  }
  return dist;
}

/**
 * Insert intermediate points around every structure change, so there is
 * somewhere for the ramp to be drawn.
 *
 * This has to happen BEFORE smoothing, and skipping it was a real bug rather
 * than an optimisation: OSM route geometry is sparse — MRT Blue is 495 points
 * over 47 km, about 95 m apart — so a ±110 m smoothing window around a portal
 * often contains only the two points either side of it and the "average" is
 * just the step back again. Blue and the ARL kept their full 33 m cliff until
 * the ramp had real vertices to live on.
 *
 * Only segments within half a ramp of a transition are densified, so a
 * uniform line gains no points at all and a mixed one gains a few dozen.
 * Inserted points take the structure of whichever side of the boundary they
 * fall on, keeping `trackStructures` meaningful (and the deck split correct)
 * rather than smearing the classification.
 */
export function densifyAroundTransitions(path, rampM = PORTAL_RAMP_M, spacingM = RAMP_SPACING_M) {
  if (path.length < 2) return path;
  const dist = cumulativeMetres(path);

  // A boundary sits between i and i+1 when the structure changes there.
  const boundaries = [];
  for (let i = 1; i < path.length; i++) {
    if (path[i][2] !== path[i - 1][2]) boundaries.push(dist[i]);
  }
  if (boundaries.length === 0) return path;

  const half = rampM / 2;
  const nearBoundary = (from, to) =>
    boundaries.some((b) => to >= b - half && from <= b + half);

  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [lon0, lat0, s0] = path[i - 1];
    const [lon1, lat1, s1] = path[i];
    const segLen = dist[i] - dist[i - 1];
    if (segLen > spacingM && nearBoundary(dist[i - 1], dist[i])) {
      const steps = Math.ceil(segLen / spacingM);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        // On the boundary segment itself the inserted points belong to the
        // structure of the nearer end; elsewhere both ends agree anyway.
        out.push([lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t, t < 0.5 ? s0 : s1]);
      }
    }
    out.push(path[i]);
  }
  return out;
}

/**
 * Smooth the altitude channel along the path with a distance-weighted moving
 * average, leaving lon/lat untouched.
 *
 * On a uniform line every altitude in the window is identical, so this is
 * exactly a no-op — which is why it can be applied unconditionally to all ten
 * lines rather than special-cased to the mixed ones. Its only effect is at
 * structure boundaries, where it turns the step into a ramp. It also
 * self-limits the stubby 2–8 point tunnel runs OSM has on ARL and SRT Red
 * (short, partly-mapped underpasses): a run far shorter than the ramp never
 * reaches full tunnel depth, becoming a shallow dip instead of a plunge that
 * would read as a data glitch.
 */
export function smoothAltitudes(path, rampM = PORTAL_RAMP_M) {
  if (path.length < 3) return path;
  const dist = cumulativeMetres(path);
  const half = rampM / 2;
  return path.map((point, i) => {
    let weighted = 0;
    let total = 0;
    // Walk outward from i in both directions until outside the window.
    for (let j = i; j >= 0 && dist[i] - dist[j] <= half; j--) {
      const w = 1 - (dist[i] - dist[j]) / half;
      weighted += w * path[j][2];
      total += w;
    }
    for (let j = i + 1; j < path.length && dist[j] - dist[i] <= half; j++) {
      const w = 1 - (dist[j] - dist[i]) / half;
      weighted += w * path[j][2];
      total += w;
    }
    const alt = total > 0 ? weighted / total : point[2];
    return [point[0], point[1], alt];
  });
}
