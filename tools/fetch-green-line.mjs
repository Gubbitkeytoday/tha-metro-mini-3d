#!/usr/bin/env node
/**
 * Fetch BTS Green Line (Sukhumvit + Silom branches) track geometry and
 * stations from OpenStreetMap via the Overpass API, and emit a compact
 * JSON asset consumed by the frontend (src/data/green-line.json).
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 — attribution is rendered
 * in the app's map attribution control.
 *
 * Usage: node tools/fetch-green-line.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/green-line.json",
);

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Elevated BTS viaduct: SRS §F1.3 specifies +12–22 m. Nominal deck height.
const ELEVATED_ALTITUDE_M = 15;

async function overpass(query) {
  let lastError;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "tha-metro-mini-3d/0.1 (data preprocessing)" },
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
  throw lastError;
}

/** Greedily stitch unordered way segments into one continuous polyline. */
function stitchWays(ways) {
  const segments = ways.map((w) => w.geometry.map((p) => [p.lon, p.lat]));
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

async function fetchBranch(relationId, branchKey) {
  const data = await overpass(`[out:json][timeout:90];relation(${relationId});out geom;`);
  const rel = data.elements.find((e) => e.type === "relation");
  if (!rel) throw new Error(`Relation ${relationId} not found`);

  const trackWays = rel.members.filter(
    (m) => m.type === "way" && m.role === "" && m.geometry,
  );
  const path = dedupe(stitchWays(trackWays));

  const stations = rel.members
    .filter((m) => m.type === "node" && /^stop/.test(m.role) && m.lat != null)
    .map((m) => ({ id: m.ref, lon: m.lon, lat: m.lat }));

  // stop_position nodes carry no tags via `out geom` members — fetch names.
  const ids = stations.map((s) => s.id).join(",");
  if (ids.length > 0) {
    const nodeData = await overpass(`[out:json][timeout:60];node(id:${ids});out;`);
    const byId = new Map(nodeData.elements.map((e) => [e.id, e.tags ?? {}]));
    for (const s of stations) {
      const tags = byId.get(s.id) ?? {};
      s.name = tags["name:en"] ?? tags.name ?? "";
      s.nameTh = tags["name:th"] ?? tags.name ?? "";
      s.code = tags.ref ?? "";
    }
  }

  console.log(
    `${branchKey}: relation ${relationId} "${rel.tags?.name ?? ""}" — ` +
      `${trackWays.length} ways -> ${path.length} points, ${stations.length} stops`,
  );
  return {
    relationId,
    osmName: rel.tags?.name ?? "",
    // [lon, lat, altitude_m] per SRS §F1.3
    track: path.map(([lon, lat]) => [lon, lat, ELEVATED_ALTITUDE_M]),
    stations: stations.map((s) => ({
      id: s.id,
      name: s.name ?? "",
      nameTh: s.nameTh ?? "",
      code: s.code ?? "",
      position: [s.lon, s.lat, ELEVATED_ALTITUDE_M],
    })),
  };
}

async function main() {
  // Discover one route relation (single direction) per branch. `name` tags
  // are Thai — match the English name. Exclude short-turn supplementary routes.
  const discovery = await overpass(
    `[out:json][timeout:60];
     relation["route"~"train|light_rail|subway"]["name:en"~"Sukhumvit|Silom"](13.5,100.3,14.1,100.8);
     out tags;`,
  );
  const candidates = discovery.elements.filter(
    (e) => e.tags?.type === "route" && !/supplementary/i.test(e.tags["name:en"] ?? ""),
  );
  console.log("Route relation candidates:");
  for (const c of candidates) {
    console.log(`  ${c.id} | ${c.tags["name:en"] ?? c.tags.name}`);
  }

  const pick = (re) => {
    const matches = candidates.filter((c) => re.test(c.tags["name:en"] ?? ""));
    if (matches.length === 0) throw new Error(`No relation matching ${re}`);
    // Route relations come in directional pairs — either variant's track is fine.
    return matches[0];
  };

  const sukhumvitRel = pick(/sukhumvit/i);
  const silomRel = pick(/silom/i);

  const [sukhumvit, silom] = [
    await fetchBranch(sukhumvitRel.id, "sukhumvit"),
    await fetchBranch(silomRel.id, "silom"),
  ];

  const out = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL 1.0",
    line: "BTS Green Line",
    branches: {
      sukhumvit: { name: "Sukhumvit Line", color: "#7CB342", ...sukhumvit },
      silom: { name: "Silom Line", color: "#00877C", ...silom },
    },
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
