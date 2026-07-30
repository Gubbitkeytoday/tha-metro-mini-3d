//! GTFS + green-line.json -> public/data/green-line.tmb (contract §2).
//!
//! Usage:
//!   cargo run -p preprocessor --release -- \
//!     --gtfs <extracted-gtfs-dir> --track src/data/green-line.json \
//!     --out public/data/green-line.tmb [--report public/data/green-line.report.json]

mod gtfs;
mod spline;

use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;
use sim_core::calendar::expand_frequency;
use sim_core::geo::{EnuProjector, ORIGIN_LNG_LAT};
use sim_core::model::*;
use sim_core::SimWorld;

const ROUTE_IDS: [&str; 2] = ["1", "2"]; // [0]=Sukhumvit, [1]=Silom
const BRANCH_KEYS: [&str; 2] = ["sukhumvit", "silom"];
const RESAMPLE_SPACING_M: f64 = 10.0;
const MAX_SNAP_M: f64 = 150.0;

#[derive(Deserialize)]
struct TrackFile {
    branches: HashMap<String, Branch>,
}

#[derive(Deserialize)]
struct Branch {
    track: Vec<[f64; 3]>,
    stations: Vec<GreenStation>,
}

#[derive(Deserialize)]
struct GreenStation {
    id: String,
    name: String,
    #[serde(rename = "nameTh")]
    name_th: String,
    #[serde(default)]
    code: String,
    position: [f64; 3],
}

struct Args {
    gtfs: PathBuf,
    track: PathBuf,
    out: PathBuf,
    report: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut gtfs = None;
    let mut track = None;
    let mut out = None;
    let mut report = None;
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = |name: &str| it.next().ok_or(format!("{name} needs a value"));
        match flag.as_str() {
            "--gtfs" => gtfs = Some(PathBuf::from(val("--gtfs")?)),
            "--track" => track = Some(PathBuf::from(val("--track")?)),
            "--out" => out = Some(PathBuf::from(val("--out")?)),
            "--report" => report = Some(PathBuf::from(val("--report")?)),
            other => return Err(format!("unknown flag '{other}'")),
        }
    }
    Ok(Args {
        gtfs: gtfs.ok_or("--gtfs is required")?,
        track: track.ok_or("--track is required")?,
        out: out.ok_or("--out is required")?,
        report,
    })
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let gtfs_dir: &Path = &args.gtfs;

    // ---- Load inputs -------------------------------------------------------
    let track_json = std::fs::read_to_string(&args.track)
        .map_err(|e| format!("cannot read {}: {e}", args.track.display()))?;
    let track_file: TrackFile =
        serde_json::from_str(&track_json).map_err(|e| format!("bad track JSON: {e}"))?;

    let feed_version = gtfs::read_feed_version(gtfs_dir)?;
    let route_rows = gtfs::read_routes(gtfs_dir, &ROUTE_IDS)?;
    for id in ROUTE_IDS {
        if !route_rows.contains_key(id) {
            return Err(format!("route_id '{id}' not found in routes.txt"));
        }
    }
    let trips = gtfs::read_trips(gtfs_dir, &ROUTE_IDS)?;
    if trips.is_empty() {
        return Err("no trips found for routes 1/2".into());
    }
    let trip_ids: HashSet<String> = trips.iter().map(|t| t.trip_id.clone()).collect();
    let service_ids: HashSet<String> = trips.iter().map(|t| t.service_id.clone()).collect();
    let stop_times = gtfs::read_stop_times(gtfs_dir, &trip_ids)?;
    let frequencies = gtfs::read_frequencies(gtfs_dir, &trip_ids)?;
    let calendar = gtfs::read_calendar(gtfs_dir, &service_ids)?;
    let mut calendar_dates = gtfs::read_calendar_dates(gtfs_dir, &service_ids)?;

    let all_stop_ids: HashSet<String> = stop_times
        .values()
        .flat_map(|rows| rows.iter().map(|r| r.stop_id.clone()))
        .collect();
    let stop_rows = gtfs::read_stops(gtfs_dir, &all_stop_ids)?;
    for id in &all_stop_ids {
        if !stop_rows.contains_key(id) {
            return Err(format!("unknown stop id '{id}' (in stop_times but not stops.txt)"));
        }
    }

    // ---- Tracks + stations -------------------------------------------------
    let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
    let mut routes: Vec<RouteDoc> = Vec::new();
    let mut station_maps: Vec<HashMap<String, u16>> = Vec::new(); // stop_id -> station_idx
    let mut max_snap_m = 0.0f64;

    for (route_id, branch_key) in ROUTE_IDS.iter().zip(BRANCH_KEYS) {
        let branch = track_file
            .branches
            .get(branch_key)
            .ok_or(format!("branch '{branch_key}' missing from track JSON"))?;
        let ctrl: Vec<[f64; 3]> = branch
            .track
            .iter()
            .map(|&[lng, lat, alt]| proj.project(lng, lat, alt))
            .collect();
        let poly = spline::catmull_rom_resample(&ctrl, RESAMPLE_SPACING_M)?;
        let arcs = spline::cumulative_arc(&poly);

        // Stop ids served by this route's patterns.
        let route_stop_ids: HashSet<&String> = trips
            .iter()
            .filter(|t| t.route_id == *route_id)
            .flat_map(|t| {
                stop_times
                    .get(&t.trip_id)
                    .map(|rows| rows.iter().map(|s| &s.stop_id))
                    .into_iter()
                    .flatten()
            })
            .collect();
        if route_stop_ids.is_empty() {
            return Err(format!("route {route_id}: no stop_times rows"));
        }

        let green_by_id: HashMap<&str, &GreenStation> =
            branch.stations.iter().map(|s| (s.id.as_str(), s)).collect();

        // Snap each GTFS stop (by lat/lng from stops.txt) onto the polyline.
        let mut snapped: Vec<(String, f64, StationDoc)> = Vec::new(); // (stop_id, snap_d, doc)
        for stop_id in route_stop_ids {
            let row = &stop_rows[stop_id];
            let p = proj.project(row.lon, row.lat, 0.0);
            let (arc_m, snap_d) = spline::snap_to_polyline(&poly, &arcs, [p[0], p[1]]);
            if snap_d > MAX_SNAP_M {
                return Err(format!(
                    "stop {stop_id} snaps {snap_d:.1} m from route {route_id} track (limit {MAX_SNAP_M} m)"
                ));
            }
            if snap_d > 40.0 {
                eprintln!(
                    "warning: stop {stop_id} ({}) is {snap_d:.1} m from route {route_id} track",
                    row.name
                );
            }
            max_snap_m = max_snap_m.max(snap_d);
            let (code, name_en, name_th) = match green_by_id.get(stop_id.as_str()) {
                Some(g) => (g.code.clone(), g.name.clone(), g.name_th.clone()),
                None => {
                    // Fall back to nearest green-line.json station by distance.
                    let nearest = branch
                        .stations
                        .iter()
                        .map(|g| {
                            let q = proj.project(g.position[0], g.position[1], 0.0);
                            let d2 = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2);
                            (d2, g)
                        })
                        .min_by(|a, b| a.0.total_cmp(&b.0));
                    let (th, en) = gtfs::split_th_en(&row.name);
                    match nearest {
                        Some((d2, g)) if d2.sqrt() < 100.0 => {
                            eprintln!(
                                "warning: stop {stop_id} not in green-line.json; matched '{}' by distance ({:.1} m)",
                                g.name,
                                d2.sqrt()
                            );
                            (g.code.clone(), g.name.clone(), g.name_th.clone())
                        }
                        _ => {
                            eprintln!(
                                "warning: stop {stop_id} not in green-line.json; using GTFS name '{en}'"
                            );
                            (String::new(), en, th)
                        }
                    }
                }
            };
            snapped.push((
                stop_id.clone(),
                snap_d,
                StationDoc { gtfs_stop_id: stop_id.clone(), code, name_en, name_th, arc_m: arc_m as f32 },
            ));
        }

        // Order by arc ascending; must be strictly increasing.
        snapped.sort_by(|a, b| a.2.arc_m.total_cmp(&b.2.arc_m));
        for w in snapped.windows(2) {
            if w[1].2.arc_m <= w[0].2.arc_m {
                return Err(format!(
                    "route {route_id}: stations {} and {} share arc position {:.1}",
                    w[0].0, w[1].0, w[0].2.arc_m
                ));
            }
        }
        let map: HashMap<String, u16> = snapped
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (id.clone(), i as u16))
            .collect();

        let rr = &route_rows[*route_id];
        routes.push(RouteDoc {
            gtfs_route_id: route_id.to_string(),
            name_en: rr.short_name.clone(),
            color_rgb: rr.color_rgb,
            track_xyz: poly.iter().map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect(),
            track_arc_m: arcs.iter().map(|&a| a as f32).collect(),
            stations: snapped.into_iter().map(|(_, _, s)| s).collect(),
        });
        station_maps.push(map);
    }

    // ---- Services ----------------------------------------------------------
    let mut service_id_list: Vec<String> = service_ids.iter().cloned().collect();
    service_id_list.sort();
    let mut services = Vec::new();
    let mut service_idx_by_id: HashMap<String, u8> = HashMap::new();
    for id in &service_id_list {
        let cal = calendar
            .get(id)
            .ok_or(format!("service '{id}' missing from calendar.txt"))?;
        let (mut added, mut removed) = calendar_dates.remove(id).unwrap_or_default();
        added.sort_unstable();
        removed.sort_unstable();
        service_idx_by_id.insert(id.clone(), services.len() as u8);
        services.push(ServiceDoc {
            gtfs_service_id: id.clone(),
            weekday_mask: cal.weekday_mask,
            start_date: cal.start_date,
            end_date: cal.end_date,
            added_dates: added,
            removed_dates: removed,
        });
    }

    // ---- Patterns ----------------------------------------------------------
    let mut patterns = Vec::new();
    let mut pattern_idx_by_trip: HashMap<String, u16> = HashMap::new();
    for trip in &trips {
        let route_idx = ROUTE_IDS.iter().position(|r| *r == trip.route_id).unwrap();
        let rows = stop_times
            .get(&trip.trip_id)
            .ok_or(format!("trip {} has no stop_times", trip.trip_id))?;
        let t0 = rows.first().map(|r| r.arrival_s).unwrap_or(0);
        let mut stops = Vec::with_capacity(rows.len());
        let mut prev_arr = 0u32;
        for row in rows {
            let station_idx = *station_maps[route_idx]
                .get(&row.stop_id)
                .ok_or(format!("trip {}: unknown stop id {}", trip.trip_id, row.stop_id))?;
            let arrival_s = row.arrival_s - t0; // relative offsets; first stop = 0
            let departure_s = row.departure_s - t0;
            if departure_s < arrival_s || arrival_s < prev_arr {
                return Err(format!("trip {}: non-monotonic stop times", trip.trip_id));
            }
            prev_arr = arrival_s;
            let arc_m = routes[route_idx].stations[station_idx as usize].arc_m;
            stops.push(PatternStop { station_idx, arrival_s, departure_s, arc_m });
        }
        let (_, headsign_en) = gtfs::split_th_en(&trip.headsign);
        pattern_idx_by_trip.insert(trip.trip_id.clone(), patterns.len() as u16);
        patterns.push(PatternDoc {
            gtfs_trip_id: trip.trip_id.clone(),
            route_idx: route_idx as u8,
            direction: trip.direction_id,
            headsign_en,
            stops,
        });
    }

    // ---- Runs (frequency expansion) ---------------------------------------
    let service_of_trip: HashMap<&str, &str> = trips
        .iter()
        .map(|t| (t.trip_id.as_str(), t.service_id.as_str()))
        .collect();
    let mut runs = Vec::new();
    for f in &frequencies {
        let pattern_idx = pattern_idx_by_trip[&f.trip_id];
        let service_idx = service_idx_by_id[service_of_trip[f.trip_id.as_str()]];
        for start_sec in expand_frequency(f.start_sec, f.end_sec, f.headway_secs) {
            runs.push(RunDoc { pattern_idx, service_idx, start_sec });
        }
    }
    if runs.is_empty() {
        return Err("frequency expansion produced zero runs".into());
    }
    runs.sort_by_key(|r| (r.service_idx, r.start_sec, r.pattern_idx));

    // ---- Encode + write ----------------------------------------------------
    let doc = CacheDoc {
        magic: TMB_MAGIC,
        version: TMB_VERSION,
        feed_version: feed_version.clone(),
        generated_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        origin_lng: ORIGIN_LNG_LAT.0,
        origin_lat: ORIGIN_LNG_LAT.1,
        routes,
        services,
        patterns,
        runs,
    };
    let bytes = bincode::serde::encode_to_vec(&doc, bincode::config::standard())
        .map_err(|e| format!("bincode encode failed: {e}"))?;
    if let Some(dir) = args.out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    std::fs::write(&args.out, &bytes)
        .map_err(|e| format!("write {}: {e}", args.out.display()))?;

    let gzip_bytes = {
        let mut gz =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&bytes).map_err(|e| e.to_string())?;
        gz.finish().map_err(|e| e.to_string())?.len()
    };

    // ---- Cross-check through sim-core + report -----------------------------
    let world = SimWorld::from_bytes(&bytes).map_err(|e| format!("self-check failed: {e}"))?;
    let v = world.validation();
    let per_route: Vec<serde_json::Value> = world
        .doc()
        .routes
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let pat_idxs: Vec<usize> = world
                .doc()
                .patterns
                .iter()
                .enumerate()
                .filter(|(_, p)| p.route_idx as usize == i)
                .map(|(k, _)| k)
                .collect();
            let run_count = world
                .doc()
                .runs
                .iter()
                .filter(|run| pat_idxs.contains(&(run.pattern_idx as usize)))
                .count();
            serde_json::json!({
                "gtfs_route_id": r.gtfs_route_id,
                "name_en": r.name_en,
                "stations": r.stations.len(),
                "track_points": r.track_xyz.len(),
                "length_m": r.track_arc_m.last().copied().unwrap_or(0.0),
                "patterns": pat_idxs.len(),
                "runs": run_count,
            })
        })
        .collect();
    let report = serde_json::json!({
        "feed_version": v.feed_version,
        "stations": v.stations,
        "patterns": v.patterns,
        "runs": v.runs,
        "services": v.services,
        "bytes": bytes.len(),
        "gzip_bytes": gzip_bytes,
        "max_snap_m": max_snap_m,
        "per_route": per_route,
    });
    let report_str = serde_json::to_string_pretty(&report).unwrap();
    if let Some(path) = &args.report {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        }
        std::fs::write(path, &report_str)
            .map_err(|e| format!("write {}: {e}", path.display()))?;
    }
    println!("{report_str}");
    Ok(())
}
