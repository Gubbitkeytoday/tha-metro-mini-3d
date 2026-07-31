#!/usr/bin/env node
/**
 * Print every route in an extracted GTFS feed with the facts the registry
 * needs: id, agency, names, colour, trip count, and whether its trips are
 * frequency-based. Read-only.
 *
 * Usage: node tools/inspect-gtfs.mjs <extracted-gtfs-dir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/inspect-gtfs.mjs <extracted-gtfs-dir>");
  process.exit(1);
}

/** Minimal CSV reader — GTFS fields may be quoted and contain commas. */
function readCsv(name) {
  const text = readFileSync(join(dir, name), "utf8").replace(/^﻿/, "");
  const rows = text.trim().split(/\r?\n/);
  const split = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)
    .slice(0, -1)
    .map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const header = split(rows[0]);
  return rows.slice(1).map((r) => Object.fromEntries(split(r).map((v, i) => [header[i], v])));
}

const routes = readCsv("routes.txt");
const trips = readCsv("trips.txt");
const freqs = readCsv("frequencies.txt");
const freqTrips = new Set(freqs.map((f) => f.trip_id));

console.log(["route_id", "agency", "short", "long", "colour", "trips", "frequency-based"].join("\t"));
for (const r of routes) {
  const mine = trips.filter((t) => t.route_id === r.route_id);
  const freqBased = mine.some((t) => freqTrips.has(t.trip_id));
  console.log(
    [r.route_id, r.agency_id ?? "", r.route_short_name ?? "", r.route_long_name ?? "",
     r.route_color ?? "", mine.length, freqBased ? "yes" : "no"].join("\t"),
  );
}
