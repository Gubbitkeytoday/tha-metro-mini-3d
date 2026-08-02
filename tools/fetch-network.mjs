#!/usr/bin/env node
/**
 * Fetch every registry line's track geometry + stations from OpenStreetMap via
 * the Overpass API into src/data/network.json.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 — attribution is rendered in the
 * app's map attribution control.
 *
 * Usage: node tools/fetch-network.mjs [lineKey ...]   (default: all lines)
 *
 * A line with `osm.relationId: null` is DISCOVERED by `osm.match` against
 * relation names in the Bangkok bbox; the resolved id is printed so it can be
 * pinned back into tools/lines.config.mjs. Discovery is for bootstrapping a new
 * line only — committed data must come from a pinned id, or the geometry
 * silently changes when OSM does.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRegistryValid, INTERCHANGE_OVERRIDES, LINES, STRUCTURE_ALTITUDE_M } from "./lines.config.mjs";
import {
  densifyAroundTransitions,
  deriveStructure,
  smoothAltitudes,
} from "./track-structure.mjs";

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/network.json");

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let lastError;
  // Two full passes over the mirror list: transient 429/504 overload on every
  // mirror at once (observed in practice — all four mirrors are apparently
  // sharing load today) usually clears within a minute, so a bare single
  // pass gives up too early. A short backoff between passes, not between
  // individual mirrors, keeps the common case (first mirror healthy) fast.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      console.warn(`  all mirrors failed once, waiting 30s before retrying...`);
      await sleep(30_000);
    }
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "User-Agent": "tha-metro-mini-3d/0.1 (data preprocessing)" },
          // The query itself carries a server-side [timeout:60], but that
          // only bounds Overpass's own execution — a mirror that accepts the
          // TCP connection and then never sends a response (rather than an
          // HTTP error) can otherwise hang the client forever. Bound it
          // client-side too so a stalled mirror fails over instead of
          // wedging the whole run.
          signal: AbortSignal.timeout(75_000),
        });
        const text = await res.text();
        if (!res.ok || text.trimStart().startsWith("<")) {
          throw new Error(`${url}: HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.warn(`Overpass mirror failed, trying next: ${err.message}`);
      }
    }
  }
  throw lastError;
}

/** Greedily stitch unordered way segments into one continuous polyline. */
function stitchWays(ways) {
  // Each point carries its way's structure as a third element so the
  // per-segment classification survives stitching (segments get reversed and
  // spliced in arbitrary order, so a parallel per-way array would not).
  const segments = ways.map((w) => w.geometry.map((p) => [p.lon, p.lat, w.structure]));
  if (segments.length === 0) return [];
  const path = segments.shift();
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4; // ~10 m

  while (segments.length > 0) {
    const head = path[0];
    const tail = path[path.length - 1];
    let bestIdx = -1;
    let bestMode = null;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (near(tail, s[0])) { bestIdx = i; bestMode = "append"; break; }
      if (near(tail, s[s.length - 1])) { bestIdx = i; bestMode = "appendRev"; break; }
      if (near(head, s[s.length - 1])) { bestIdx = i; bestMode = "prepend"; break; }
      if (near(head, s[0])) { bestIdx = i; bestMode = "prependRev"; break; }
    }
    if (bestIdx === -1) {
      // No touching segment (parallel track of the opposite direction,
      // depot spur, etc.) — drop the remainder rather than jumping gaps.
      break;
    }
    const seg = segments.splice(bestIdx, 1)[0];
    if (bestMode === "append") path.push(...seg.slice(1));
    else if (bestMode === "appendRev") path.push(...seg.reverse().slice(1));
    else if (bestMode === "prepend") path.unshift(...seg.slice(0, -1));
    else path.unshift(...seg.reverse().slice(0, -1));
  }
  return path;
}

/** Drop consecutive duplicate points. */
function dedupe(coords) {
  return coords.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - coords[i - 1][0], p[1] - coords[i - 1][1]) > 1e-7,
  );
}

async function fetchBranch(relationId, branchKey, nominalStructure) {
  const data = await overpass(`[out:json][timeout:90];relation(${relationId});out geom;`);
  const rel = data.elements.find((e) => e.type === "relation");
  if (!rel) throw new Error(`Relation ${relationId} not found`);

  const trackWays = rel.members.filter(
    (m) => m.type === "way" && m.role === "" && m.geometry,
  );

  // Member ways come back from `out geom` with geometry but WITHOUT tags (the
  // same omission the station-node code below already works around), so
  // tunnel/bridge have to be fetched in a follow-up query before the
  // per-segment structure can be derived.
  const wayIds = trackWays.map((w) => w.ref).join(",");
  let tagsById = new Map();
  if (wayIds.length > 0) {
    const wayData = await overpass(`[out:json][timeout:90];way(id:${wayIds});out tags;`);
    tagsById = new Map(wayData.elements.map((e) => [String(e.id), e.tags ?? {}]));
  }
  for (const w of trackWays) {
    w.structure = deriveStructure(tagsById.get(String(w.ref)), nominalStructure);
  }

  // Densify before the altitudes are assigned so the ramp has vertices to be
  // drawn on — OSM route geometry is far too sparse at portals otherwise.
  const path = densifyAroundTransitions(dedupe(stitchWays(trackWays)));

  // Candidate stop/platform node members: PTv2 route relations mark these
  // either with an explicit role starting "stop"/"platform", OR with an
  // empty role and a public_transport=stop_position/station/platform tag
  // instead (confirmed live: relation 2067854 "Silom" has 14 node members,
  // only 3 with role=stop — the other 11 are role="" but are real, named
  // railway=station nodes; filtering on role alone silently dropped them).
  // Tags aren't present on member nodes in this `out geom` response
  // (verified live), so cast a wide net here on role + lat/lon, and let the
  // tag-based check below (after the second query) do the real filtering.
  const candidates = rel.members
    .filter((m) => m.type === "node" && m.lat != null)
    // Stringify: Overpass returns node refs as JSON numbers, but the Rust
    // preprocessor's NetworkStation.id is a String (it's compared against
    // GTFS stop_id strings for the code/name lookup) — a bare number here
    // fails deserialization with "invalid type: integer, expected a string".
    .map((m) => ({ id: String(m.ref), role: m.role, lon: m.lon, lat: m.lat }));

  // stop_position/station nodes carry no tags via `out geom` members —
  // fetch tags for every candidate in one follow-up query, then filter.
  const ids = candidates.map((s) => s.id).join(",");
  let byId = new Map();
  if (ids.length > 0) {
    const nodeData = await overpass(`[out:json][timeout:60];node(id:${ids});out;`);
    // Key on String(e.id): Overpass returns numeric ids here too, and a
    // number-vs-string key mismatch against candidates' string ids would
    // make every lookup miss silently (byId.get() found nothing, so every
    // station fell back to "" name/code — this broke ALL 155 stations'
    // OSM-sourced names/codes network-wide before this fix).
    byId = new Map(nodeData.elements.map((e) => [String(e.id), e.tags ?? {}]));
  }

  const STOP_LIKE = new Set(["stop_position", "station", "platform"]);
  const stations = candidates.filter((s) => {
    if (/^stop/.test(s.role)) return true;
    const pt = byId.get(s.id)?.public_transport;
    return typeof pt === "string" && STOP_LIKE.has(pt);
  });
  for (const s of stations) {
    const tags = byId.get(s.id) ?? {};
    s.name = tags["name:en"] ?? tags.name ?? "";
    s.nameTh = tags["name:th"] ?? tags.name ?? "";
    s.code = tags.ref ?? "";
    // Every localised name OSM carries for this stop, keyed by BCP-47-ish
    // language subtag. Coverage is real but uneven — surveyed live on
    // 2026-08-02 across all ten relations: en 194/195, th 153, zh 27, ja 18,
    // ko 4, fr 4, ru 2, de 1 — which is exactly why the UI offers the
    // languages the DATA has rather than a list of languages it doesn't.
    s.names = {};
    for (const [key, value] of Object.entries(tags)) {
      if (!key.startsWith("name:") || typeof value !== "string" || !value) continue;
      const lang = key.slice(5);
      // Skip OSM's non-language name variants (name:left, name:prefix, ...)
      // and script/etymology qualifiers, which are not translations.
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang)) continue;
      s.names[lang] = value;
    }
  }

  // [lon, lat, altitude_m] per SRS §F1.3, altitude now per point rather than
  // per line — see deriveStructure().
  const track = smoothAltitudes(
    path.map(([lon, lat, structure]) => [lon, lat, STRUCTURE_ALTITUDE_M[structure]]),
  );
  const trackStructures = path.map(([, , structure]) => structure);

  // A station sits at its track's altitude, not the line's nominal one: on a
  // mixed line an underground platform rendered at +15 m would float above the
  // tunnel it serves (and its support pole would be drawn upside down). Snap
  // to the nearest track point — the same point the Rust preprocessor snaps
  // the GTFS stop to, so the marker and the train agree.
  const stationAltitude = (lon, lat) => {
    let best = STRUCTURE_ALTITUDE_M[nominalStructure];
    let bestD2 = Infinity;
    for (const [tLon, tLat, alt] of track) {
      const d2 = (tLon - lon) ** 2 + (tLat - lat) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = alt;
      }
    }
    return best;
  };

  const mix = trackStructures.reduce((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {});
  console.log(
    `${branchKey}: relation ${relationId} "${rel.tags?.name ?? ""}" — ` +
      `${trackWays.length} ways -> ${path.length} points, ${stations.length} stops, ` +
      `structure ${JSON.stringify(mix)}`,
  );
  return {
    relationId,
    osmName: rel.tags?.name ?? "",
    track,
    trackStructures,
    stations: stations.map((s) => ({
      id: s.id,
      name: s.name ?? "",
      nameTh: s.nameTh ?? "",
      names: s.names ?? {},
      code: s.code ?? "",
      position: [s.lon, s.lat, stationAltitude(s.lon, s.lat)],
    })),
  };
}

/** Resolve a relation id from `osm.match` when none is pinned. */
async function discoverRelationId(line) {
  const data = await overpass(
    `[out:json][timeout:60];
     relation["route"~"train|light_rail|subway|monorail"](13.4,100.2,14.3,101.0);
     out tags;`,
  );
  const candidates = data.elements.filter(
    (e) =>
      e.tags?.type === "route" &&
      line.osm.match.test(`${e.tags["name:en"] ?? ""} ${e.tags.name ?? ""}`) &&
      !/supplementary/i.test(e.tags["name:en"] ?? ""),
  );
  console.log(`${line.key}: ${candidates.length} candidate relation(s)`);
  for (const c of candidates) console.log(`  ${c.id} | ${c.tags["name:en"] ?? c.tags.name}`);
  if (candidates.length === 0) throw new Error(`${line.key}: no relation matched ${line.osm.match}`);
  // Route relations come in directional pairs — either variant's track is fine.
  console.log(`  -> pin osm.relationId: ${candidates[0].id} in tools/lines.config.mjs`);
  return candidates[0].id;
}

async function main() {
  assertRegistryValid();
  const only = process.argv.slice(2);
  const selected = only.length > 0 ? LINES.filter((l) => only.includes(l.key)) : LINES;
  if (selected.length === 0) throw new Error(`no registry line matches ${only.join(", ")}`);

  // A subset run refreshes only the named lines but must still write a file
  // covering the WHOLE registry in registry order: `lines[i]` index is the
  // load-bearing route_idx shared with the Rust cache and the vehicle buffer,
  // so emitting just the fetched subset would silently renumber every route
  // (and orphan the committed .tmb). Unfetched lines are carried over from the
  // existing file; a subset run that names a line the current file has never
  // seen is a hard error rather than a hole in the array.
  const previous = new Map();
  if (selected.length !== LINES.length) {
    try {
      const prior = JSON.parse(await readFile(OUT_PATH, "utf8"));
      for (const l of prior.lines ?? []) previous.set(l.key, l);
    } catch {
      throw new Error(
        `subset fetch needs an existing ${OUT_PATH} to merge into — run without arguments first`,
      );
    }
  }

  const lines = [];
  for (const line of LINES) {
    if (!selected.includes(line)) {
      const carried = previous.get(line.key);
      if (!carried) {
        throw new Error(
          `${line.key} is in the registry but not in the existing network.json — ` +
            `run without arguments to fetch every line`,
        );
      }
      lines.push(carried);
      continue;
    }
    const relationId = line.osm.relationId ?? (await discoverRelationId(line));
    const geom = await fetchBranch(relationId, line.key, line.structure);
    lines.push({
      key: line.key,
      name: line.name,
      nameTh: line.nameTh,
      color: line.color,
      structure: line.structure,
      vehicleType: line.vehicleType,
      gtfsRouteId: line.gtfsRouteId,
      excludeGtfsStopIds: line.excludeGtfsStopIds ?? [],
      allowLargeSnapStopIds: line.allowLargeSnapStopIds ?? [],
      ...geom,
    });
  }

  const out = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL 1.0",
    lines,
    interchangeOverrides: INTERCHANGE_OVERRIDES,
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote ${OUT_PATH} (${lines.length} lines)`);
}

// Only fetch when run as a CLI. The pure helpers above (deriveStructure,
// smoothAltitudes) are unit-tested by tools/fetch-network.test.mjs, and an
// unguarded main() would fire a full Overpass run on import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
