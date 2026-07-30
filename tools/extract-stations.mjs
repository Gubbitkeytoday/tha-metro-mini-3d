#!/usr/bin/env node
/**
 * Extract BTS Green Line station coordinates from the Namtang GTFS feed
 * (https://namtang-api.otp.go.th/opendata, CC-BY 4.0) and merge them into
 * src/data/green-line.json (which must already exist — run
 * fetch-green-line.mjs first for the OSM track geometry).
 *
 * Usage: node tools/extract-stations.mjs <path-to-extracted-gtfs-dir>
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GTFS_DIR = process.argv[2];
if (!GTFS_DIR) {
  console.error("Usage: node tools/extract-stations.mjs <gtfs-dir>");
  process.exit(1);
}

const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/green-line.json",
);

const ELEVATED_ALTITUDE_M = 15;

/** Minimal CSV parser handling quoted fields. Returns array of row objects. */
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
      field = ""; row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

async function loadCsv(name) {
  return parseCsv(await readFile(join(GTFS_DIR, name), "utf8"));
}

/** Namtang names are "ไทย;English" — split them. */
function splitName(s) {
  const [th, en] = (s ?? "").split(";");
  return { th: (th ?? "").trim(), en: (en ?? th ?? "").trim() };
}

async function main() {
  const ROUTE_IDS = { sukhumvit: "1", silom: "2" }; // BTSC routes in the Namtang feed

  const trips = await loadCsv("trips.txt");
  const stopTimes = await loadCsv("stop_times.txt");
  const stops = await loadCsv("stops.txt");
  const stopById = new Map(stops.map((s) => [s.stop_id, s]));

  const doc = JSON.parse(await readFile(OUT_PATH, "utf8"));

  for (const [branchKey, routeId] of Object.entries(ROUTE_IDS)) {
    // Pick the trip with the most stops for this route (full-length service).
    const routeTrips = new Set(
      trips.filter((t) => t.route_id === routeId).map((t) => t.trip_id),
    );
    const byTrip = new Map();
    for (const st of stopTimes) {
      if (!routeTrips.has(st.trip_id)) continue;
      if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
      byTrip.get(st.trip_id).push(st);
    }
    let best = [];
    for (const seq of byTrip.values()) if (seq.length > best.length) best = seq;
    best.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

    const stations = best.map((st) => {
      const s = stopById.get(st.stop_id);
      const name = splitName(s.stop_name);
      return {
        id: s.stop_id,
        name: name.en,
        nameTh: name.th,
        code: s.stop_code ?? "",
        position: [Number(s.stop_lon), Number(s.stop_lat), ELEVATED_ALTITUDE_M],
      };
    });

    if (stations.length === 0) throw new Error(`No stations resolved for ${branchKey}`);
    doc.branches[branchKey].stations = stations;
    doc.branches[branchKey].stationSource =
      "Namtang GTFS (namtang-api.otp.go.th) — CC-BY 4.0, สนข./OTP";
    console.log(`${branchKey}: ${stations.length} stations (route_id ${routeId})`);
    console.log(`  ${stations.map((s) => s.code || s.name).join(", ")}`);
  }

  await writeFile(OUT_PATH, JSON.stringify(doc));
  console.log(`Updated ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
