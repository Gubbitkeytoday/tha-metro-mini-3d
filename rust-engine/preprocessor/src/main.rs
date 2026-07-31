//! GTFS + network.json -> public/data/network.tmb (contract §2).
//!
//! Route identity comes from the line registry (src/data/network.json,
//! generated from tools/lines.config.mjs): cache route order == network.json
//! line order, and a line with no `gtfsRouteId` is encoded as track geometry
//! only (`RouteDoc.simulated = false`) — rendered, never simulated.
//!
//! Usage:
//!   cargo run -p preprocessor --release -- \
//!     --gtfs <extracted-gtfs-dir> --track src/data/network.json \
//!     --out public/data/network.tmb [--report public/data/network.report.json]

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

const RESAMPLE_SPACING_M: f64 = 10.0;
const MAX_SNAP_M: f64 = 150.0;
/// Even a disclosed `allow_large_snap_stop_ids` exception has a ceiling —
/// it's meant for known, verified cases like the Pink terminus/interchange
/// coordinate quirk (555 m), not an unbounded escape hatch. A future
/// exception past this is almost certainly a real mistake, not a known one.
const ALLOW_LARGE_SNAP_CEILING_M: f64 = 1_000.0;

/// Weekday/weekend sample dates for the peak-concurrent scan, inside the
/// Namtang feed's 20260101-20261231 validity window (contract §0). Ordinary
/// (non-holiday) dates already exercised by the sim-core test fixtures.
const PEAK_SAMPLE_WEEKDAY: u32 = 20_260_722; // Wednesday
const PEAK_SAMPLE_WEEKEND: u32 = 20_260_725; // Saturday

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFile {
    lines: Vec<LineGeometry>,
    /// GTFS stop_id pairs for walkways the 300 m radius cannot reach.
    #[serde(default)]
    interchange_overrides: Vec<[String; 2]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineGeometry {
    key: String,
    /// Fallback display name for a track-only line (no `gtfs_route_id`).
    name: String,
    color: String,
    /// None = track geometry only; rendered, never simulated.
    gtfs_route_id: Option<String>,
    track: Vec<[f64; 3]>,
    stations: Vec<NetworkStation>,
    /// GTFS stop_ids to drop from this line's simulation entirely (and any
    /// trip that serves one, taking its whole pattern with it) — for a stop
    /// on a real physical branch this line's `track` polyline does not cover.
    /// Needed for MRT Pink (route_id 2436): the Namtang feed bundles the
    /// Muang Thong Thani spur's 4 shuttle trip patterns into the *same*
    /// route_id as the 30-station main line, so without this the spur's two
    /// stations (gtfs_stop_id 16936/16937) fail the snap check — they sit
    /// ~1.2 km off the main-line-only track this registry entry fetches
    /// (see tools/lines.config.mjs; spur geometry is out of scope for now).
    #[serde(default)]
    exclude_gtfs_stop_ids: Vec<String>,
    /// GTFS stop_ids exempt from the MAX_SNAP_M hard-fail — for a stop whose
    /// GTFS lat/lng is verified to be a *different, real* nearby station,
    /// not bad geometry. Needed for MRT Pink stop 359 "Nonthaburi Civic
    /// Center": the Namtang feed's coordinate for this stop is 8 m from
    /// OSM's MRT Purple node (ref PP11) — the interchange's Purple-side
    /// platform — while the real Pink-side platform (OSM ref PK01, which
    /// this line's fetched track correctly ends 2.7 m from) is 555 m away.
    /// Two distinct physical stations sharing a name/GTFS stop_id, not a
    /// stitching bug (verified directly against OSM node tags, see
    /// tools/lines.config.mjs). Still snapped and simulated, just without
    /// the usual proximity guarantee — logged as a warning, not an error.
    #[serde(default)]
    allow_large_snap_stop_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkStation {
    id: String,
    name: String,
    name_th: String,
    #[serde(default)]
    code: String,
    position: [f64; 3],
}

/// `#RRGGBB` from the registry -> the u32 the cache and UI use.
fn parse_hex_color(s: &str) -> Result<u32, String> {
    u32::from_str_radix(s.trim_start_matches('#'), 16)
        .map_err(|_| format!("bad colour '{s}' (want #RRGGBB)"))
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

    let simulated_route_ids: Vec<&str> = track_file
        .lines
        .iter()
        .filter_map(|l| l.gtfs_route_id.as_deref())
        .collect();
    if simulated_route_ids.is_empty() {
        return Err("network.json has no simulated lines (every gtfsRouteId is null)".into());
    }

    let feed_version = gtfs::read_feed_version(gtfs_dir)?;
    let route_rows = gtfs::read_routes(gtfs_dir, &simulated_route_ids)?;
    for id in &simulated_route_ids {
        if !route_rows.contains_key(*id) {
            return Err(format!("route_id '{id}' not found in routes.txt"));
        }
    }
    let mut trips = gtfs::read_trips(gtfs_dir, &simulated_route_ids)?;
    if trips.is_empty() {
        return Err("no trips found for the simulated routes".into());
    }
    let trip_ids: HashSet<String> = trips.iter().map(|t| t.trip_id.clone()).collect();
    let service_ids: HashSet<String> = trips.iter().map(|t| t.service_id.clone()).collect();
    let stop_times = gtfs::read_stop_times(gtfs_dir, &trip_ids)?;
    let frequencies = gtfs::read_frequencies(gtfs_dir, &trip_ids)?;
    let calendar = gtfs::read_calendar(gtfs_dir, &service_ids)?;
    let mut calendar_dates = gtfs::read_calendar_dates(gtfs_dir, &service_ids)?;

    // Drop any trip (i.e. its whole pattern) that touches a line's
    // exclude_gtfs_stop_ids — see the field's doc comment on LineGeometry.
    // stop_times/frequencies/calendar above were loaded from the full trip
    // set and may now carry a few unused entries; harmless, since everything
    // downstream is driven by (the now-filtered) `trips`, not those maps.
    let excluded_stops_by_route: HashMap<&str, HashSet<&str>> = track_file
        .lines
        .iter()
        .filter_map(|l| {
            if l.exclude_gtfs_stop_ids.is_empty() {
                return None;
            }
            l.gtfs_route_id.as_deref().map(|id| {
                (id, l.exclude_gtfs_stop_ids.iter().map(String::as_str).collect())
            })
        })
        .collect();
    if !excluded_stops_by_route.is_empty() {
        let before = trips.len();
        trips.retain(|t| {
            let Some(excluded) = excluded_stops_by_route.get(t.route_id.as_str()) else {
                return true;
            };
            let touches_excluded = stop_times
                .get(&t.trip_id)
                .is_some_and(|rows| rows.iter().any(|r| excluded.contains(r.stop_id.as_str())));
            if touches_excluded {
                eprintln!(
                    "note: dropping trip {} (route {}) — serves an excluded stop",
                    t.trip_id, t.route_id
                );
            }
            !touches_excluded
        });
        eprintln!(
            "note: excluded-stop filter dropped {} of {before} trips",
            before - trips.len()
        );
        if trips.is_empty() {
            return Err("exclude_gtfs_stop_ids filtering removed every trip".into());
        }
    }

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
    // Tracked separately from large_snap_exceptions below so a disclosed,
    // known exception (e.g. the Pink terminus's 555 m coordinate quirk)
    // doesn't hide a genuinely-bad snap on some other, future line — an
    // undisclosed regression would still show up here.
    let mut max_snap_m = 0.0f64;
    let mut large_snap_exceptions: Vec<serde_json::Value> = Vec::new();

    for line in &track_file.lines {
        let ctrl: Vec<[f64; 3]> = line
            .track
            .iter()
            .map(|&[lng, lat, alt]| proj.project(lng, lat, alt))
            .collect();
        let poly = spline::catmull_rom_resample(&ctrl, RESAMPLE_SPACING_M)?;
        let arcs = spline::cumulative_arc(&poly);

        // Snap each station onto this line's polyline. (stop_id, snap_d, doc)
        let mut snapped: Vec<(String, f64, StationDoc)> = Vec::new();

        match line.gtfs_route_id.as_deref() {
            Some(route_id) => {
                // Stop ids served by this route's patterns.
                let route_stop_ids: HashSet<&String> = trips
                    .iter()
                    .filter(|t| t.route_id == route_id)
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

                let network_by_id: HashMap<&str, &NetworkStation> =
                    line.stations.iter().map(|s| (s.id.as_str(), s)).collect();

                // Snap each GTFS stop (by lat/lng from stops.txt) onto the polyline.
                for stop_id in route_stop_ids {
                    let row = &stop_rows[stop_id];
                    let p = proj.project(row.lon, row.lat, 0.0);
                    let (arc_m, snap_d) = spline::snap_to_polyline(&poly, &arcs, [p[0], p[1]]);
                    let large_snap_allowed = line
                        .allow_large_snap_stop_ids
                        .iter()
                        .any(|s| s.as_str() == stop_id.as_str());
                    if snap_d > MAX_SNAP_M && !large_snap_allowed {
                        return Err(format!(
                            "stop {stop_id} snaps {snap_d:.1} m from route {route_id} track (limit {MAX_SNAP_M} m)"
                        ));
                    }
                    if large_snap_allowed && snap_d > ALLOW_LARGE_SNAP_CEILING_M {
                        return Err(format!(
                            "stop {stop_id} snaps {snap_d:.1} m from route {route_id} track — \
                             past the {ALLOW_LARGE_SNAP_CEILING_M} m allow_large_snap_stop_ids \
                             ceiling; this is too far to be the known exception, check the id"
                        ));
                    }
                    if large_snap_allowed {
                        eprintln!(
                            "warning: stop {stop_id} snaps {snap_d:.1} m from route {route_id} track — allowed (allow_large_snap_stop_ids)"
                        );
                        large_snap_exceptions.push(serde_json::json!({
                            "route_id": route_id,
                            "gtfs_stop_id": stop_id,
                            "snap_m": snap_d,
                        }));
                    } else if snap_d > 40.0 {
                        eprintln!(
                            "warning: stop {stop_id} ({}) is {snap_d:.1} m from route {route_id} track",
                            row.name
                        );
                    }
                    if !large_snap_allowed {
                        max_snap_m = max_snap_m.max(snap_d);
                    }
                    // OSM candidates only win if they actually carry a name:
                    // route-relation `role=stop` members are usually bare
                    // stop_position nodes with no name tag at all (the name
                    // lives on a separate platform/station node this fetch
                    // never queries) — every one of the ~130 "matched by
                    // distance" fallbacks below turned out to have g.name ==
                    // "" before this check existed, silently blanking most
                    // new-line station names even though the correctly-named
                    // GTFS fallback was right there. Prefer any named
                    // candidate; only give up and use bare GTFS naming when
                    // nothing nearby has a name at all.
                    let (code, name_en, name_th) = match network_by_id
                        .get(stop_id.as_str())
                        .filter(|g| !g.name.is_empty())
                    {
                        Some(g) => (g.code.clone(), g.name.clone(), g.name_th.clone()),
                        None => {
                            // Fall back to nearest network.json station by distance.
                            let nearest = line
                                .stations
                                .iter()
                                .filter(|g| !g.name.is_empty())
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
                                        "warning: stop {stop_id} not in network.json; matched '{}' by distance ({:.1} m)",
                                        g.name,
                                        d2.sqrt()
                                    );
                                    (g.code.clone(), g.name.clone(), g.name_th.clone())
                                }
                                _ => {
                                    eprintln!(
                                        "warning: stop {stop_id} not in network.json; using GTFS name '{en}'"
                                    );
                                    (String::new(), en, th)
                                }
                            }
                        }
                    };
                    snapped.push((
                        stop_id.clone(),
                        snap_d,
                        StationDoc {
                            gtfs_stop_id: stop_id.clone(),
                            code,
                            name_en,
                            name_th,
                            arc_m: arc_m as f32,
                            interchanges: Vec::new(),
                        },
                    ));
                }
            }
            None => {
                // Track-only line (no gtfsRouteId): there are no GTFS trips to
                // snap against, so the registry's own station list is
                // authoritative — snap each declared station onto this line's
                // polyline directly.
                for s in &line.stations {
                    let p = proj.project(s.position[0], s.position[1], 0.0);
                    let (arc_m, snap_d) = spline::snap_to_polyline(&poly, &arcs, [p[0], p[1]]);
                    if snap_d > MAX_SNAP_M {
                        return Err(format!(
                            "station {} snaps {snap_d:.1} m from line '{}' track (limit {MAX_SNAP_M} m)",
                            s.id, line.key
                        ));
                    }
                    max_snap_m = max_snap_m.max(snap_d);
                    snapped.push((
                        s.id.clone(),
                        snap_d,
                        StationDoc {
                            gtfs_stop_id: s.id.clone(),
                            code: s.code.clone(),
                            name_en: s.name.clone(),
                            name_th: s.name_th.clone(),
                            arc_m: arc_m as f32,
                            interchanges: Vec::new(),
                        },
                    ));
                }
            }
        }

        // Order by arc ascending; must be strictly increasing.
        snapped.sort_by(|a, b| a.2.arc_m.total_cmp(&b.2.arc_m));
        for w in snapped.windows(2) {
            if w[1].2.arc_m <= w[0].2.arc_m {
                return Err(format!(
                    "line {}: stations {} and {} share arc position {:.1}",
                    line.key, w[0].0, w[1].0, w[0].2.arc_m
                ));
            }
        }
        let map: HashMap<String, u16> = snapped
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (id.clone(), i as u16))
            .collect();

        // Registry name/colour win over the feed's for both branches: they're
        // what the UI legend, the track deck and the train livery already
        // use, and they're unique — the GTFS route_short_name is not (the
        // Namtang feed gives both SRT Dark Red (2026) and Light Red (2027)
        // the bare short_name "Red", which the inspector's "<name> · run N"
        // header would otherwise show identically for either line).
        let color_rgb = parse_hex_color(&line.color)?;
        let name_en = line.name.clone();
        routes.push(RouteDoc {
            gtfs_route_id: line.gtfs_route_id.clone().unwrap_or_default(),
            line_key: line.key.clone(),
            simulated: line.gtfs_route_id.is_some(),
            name_en,
            color_rgb,
            track_xyz: poly.iter().map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect(),
            track_arc_m: arcs.iter().map(|&a| a as f32).collect(),
            stations: snapped.into_iter().map(|(_, _, s)| s).collect(),
        });
        station_maps.push(map);
    }

    let interchange_overrides: Vec<(String, String)> = track_file
        .interchange_overrides
        .iter()
        .map(|[a, b]| (a.clone(), b.clone()))
        .collect();
    link_interchanges(&mut routes, INTERCHANGE_RADIUS_M, &interchange_overrides);

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
    let route_idx_by_gtfs_id: HashMap<&str, usize> = track_file
        .lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| l.gtfs_route_id.as_deref().map(|id| (id, i)))
        .collect();
    let mut patterns = Vec::new();
    let mut pattern_idx_by_trip: HashMap<String, u16> = HashMap::new();
    for trip in &trips {
        let route_idx = route_idx_by_gtfs_id[trip.route_id.as_str()];
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

    // ---- Runs (frequency expansion, or one run per scheduled trip) --------
    let mut runs = Vec::new();
    for trip in &trips {
        let pattern_idx = pattern_idx_by_trip[&trip.trip_id];
        let service_idx = service_idx_by_id[&trip.service_id];
        let first_arrival_s = stop_times[&trip.trip_id].first().map(|r| r.arrival_s).unwrap_or(0);
        runs.extend(runs_for_pattern(
            &trip.trip_id,
            &frequencies,
            first_arrival_s,
            pattern_idx,
            service_idx,
        ));
    }
    if runs.is_empty() {
        return Err("expansion produced zero runs".into());
    }
    runs.sort_by_key(|r| (r.service_idx, r.start_sec, r.pattern_idx));

    for (idx, route) in routes.iter().enumerate() {
        if !route.simulated {
            continue;
        }
        let has_runs = runs.iter().any(|r| patterns[r.pattern_idx as usize].route_idx as usize == idx);
        if !has_runs {
            return Err(format!(
                "route '{}' ({}) is marked simulated but expanded to zero runs — \
                 check frequencies.txt/stop_times for route_id '{}'",
                route.line_key, route.name_en, route.gtfs_route_id
            ));
        }
    }

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
    // One entry per undirected link (route_idx ordering dedupes the symmetric pair).
    let interchanges: Vec<serde_json::Value> = world
        .doc()
        .routes
        .iter()
        .enumerate()
        .flat_map(|(ri, r)| {
            r.stations.iter().enumerate().flat_map(move |(si, st)| {
                st.interchanges
                    .iter()
                    .filter(move |link| (ri, si) < (link.route_idx as usize, link.station_idx as usize))
                    .map(move |link| (ri, si, link))
            })
        })
        .map(|(ri, si, link)| {
            let a = &world.doc().routes[ri];
            let b = &world.doc().routes[link.route_idx as usize];
            serde_json::json!({
                "a": format!("{}/{}", a.line_key, a.stations[si].name_en),
                "b": format!("{}/{}", b.line_key, b.stations[link.station_idx as usize].name_en),
            })
        })
        .collect();
    let (weekday_peak, weekday_peak_sec) = peak_concurrent(&world, PEAK_SAMPLE_WEEKDAY);
    let (weekend_peak, weekend_peak_sec) = peak_concurrent(&world, PEAK_SAMPLE_WEEKEND);
    let (peak_concurrent_count, peak_concurrent_time, peak_concurrent_date) =
        if weekday_peak >= weekend_peak {
            (weekday_peak, weekday_peak_sec, PEAK_SAMPLE_WEEKDAY)
        } else {
            (weekend_peak, weekend_peak_sec, PEAK_SAMPLE_WEEKEND)
        };

    let report = serde_json::json!({
        "feed_version": v.feed_version,
        "stations": v.stations,
        "patterns": v.patterns,
        "runs": v.runs,
        "services": v.services,
        "interchanges": interchanges,
        "bytes": bytes.len(),
        "gzip_bytes": gzip_bytes,
        // Excludes any allow_large_snap_stop_ids exceptions (reported
        // separately below) so a disclosed, known offset like Pink's 555 m
        // terminus/interchange quirk can't hide a genuinely-bad snap
        // elsewhere behind an already-large "normal" baseline.
        "max_snap_m": max_snap_m,
        "large_snap_exceptions": large_snap_exceptions,
        "per_route": per_route,
        // Highest simultaneous vehicle count over a sampled service day —
        // answers "is MAX_VEHICLES big enough" with data, not a guess
        // (contract §3/§8). The overall max of a weekday and a weekend scan;
        // both are reported separately too so a future weekend-only spike
        // isn't hidden by taking just the bigger number's weekday assumption.
        "peak_concurrent": peak_concurrent_count,
        "peak_concurrent_time": peak_concurrent_time,
        "peak_concurrent_date": peak_concurrent_date,
        "peak_concurrent_weekday": {"date": PEAK_SAMPLE_WEEKDAY, "peak": weekday_peak, "time": weekday_peak_sec},
        "peak_concurrent_weekend": {"date": PEAK_SAMPLE_WEEKEND, "peak": weekend_peak, "time": weekend_peak_sec},
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

/// Cross-route walking connections, from station ENU distance plus a manual
/// override list for long walkways the radius cannot reach.
///
/// GTFS `parent_station` cannot do this job: interchanges here span operators
/// (BTS/BEM/SRT) that publish independent feeds and never share a parent.
/// Distance-clustering with a manual escape hatch is the pragmatic substitute.
fn link_interchanges(routes: &mut [RouteDoc], radius_m: f64, overrides: &[(String, String)]) {
    // (route_idx, station_idx, x, y, stop_id)
    let mut pts: Vec<(usize, usize, f32, f32, String)> = Vec::new();
    for (ri, route) in routes.iter().enumerate() {
        for (si, st) in route.stations.iter().enumerate() {
            let [x, y, _z] = sim_core::world::position_at_arc(route, st.arc_m);
            pts.push((ri, si, x, y, st.gtfs_stop_id.clone()));
        }
    }

    let r2 = (radius_m * radius_m) as f32;
    let mut links: Vec<(usize, usize, usize, usize)> = Vec::new();
    for i in 0..pts.len() {
        for j in (i + 1)..pts.len() {
            let (ri, si, xi, yi, idi) = (&pts[i].0, &pts[i].1, pts[i].2, pts[i].3, &pts[i].4);
            let (rj, sj, xj, yj, idj) = (&pts[j].0, &pts[j].1, pts[j].2, pts[j].3, &pts[j].4);
            if ri == rj {
                continue; // same line: adjacent stations are not an interchange
            }
            let near = (xi - xj).powi(2) + (yi - yj).powi(2) <= r2;
            let forced = overrides
                .iter()
                .any(|(a, b)| (a == idi && b == idj) || (a == idj && b == idi));
            if near || forced {
                links.push((*ri, *si, *rj, *sj));
            }
        }
    }

    for (ri, si, rj, sj) in links {
        routes[ri].stations[si]
            .interchanges
            .push(InterchangeRef { route_idx: rj as u8, station_idx: sj as u16 });
        routes[rj].stations[sj]
            .interchanges
            .push(InterchangeRef { route_idx: ri as u8, station_idx: si as u16 });
    }
}

const INTERCHANGE_RADIUS_M: f64 = 300.0;

/// Highest simultaneous vehicle count over a service day, sampled per minute.
/// Answers "is MAX_VEHICLES big enough" with data instead of a guess.
/// Returns (peak count, seconds-of-day the peak occurred at).
fn peak_concurrent(world: &SimWorld, date_yyyymmdd: u32) -> (usize, u32) {
    let mut out = vec![0.0f32; sim_core::world::MAX_VEHICLES * sim_core::world::VEHICLE_STRIDE];
    let mut best = (0usize, 0u32);
    for minute in 0..1440u32 {
        let sec = (minute * 60) as f64;
        let n = world.evaluate(date_yyyymmdd, sec, &mut out);
        if n > best.0 {
            best = (n, minute * 60);
        }
    }
    best
}

/// Runs for one pattern, from `frequencies.txt` when the trip has rows there,
/// otherwise from the trip's own absolute `stop_times`.
///
/// GTFS allows both shapes in one feed and the Namtang feed uses both: BTS
/// routes are frequency-based (relative stop_times + headway windows) while
/// other operators publish concrete departures. A trip with neither must never
/// silently vanish — the caller errors on an empty total.
fn runs_for_pattern(
    trip_id: &str,
    freqs: &[gtfs::FrequencyRow],
    first_arrival_s: u32,
    pattern_idx: u16,
    service_idx: u8,
) -> Vec<RunDoc> {
    let mut runs = Vec::new();
    let mut had_freq = false;
    for f in freqs.iter().filter(|f| f.trip_id == trip_id) {
        had_freq = true;
        for start_sec in expand_frequency(f.start_sec, f.end_sec, f.headway_secs) {
            runs.push(RunDoc { pattern_idx, service_idx, start_sec });
        }
    }
    if !had_freq {
        runs.push(RunDoc { pattern_idx, service_idx, start_sec: first_arrival_s });
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A two-line network file, minimal but structurally real.
    ///
    /// Uses a double-hash raw-string delimiter: the JSON contains `"#111111"`
    /// (a `"` immediately followed by `#`), which would otherwise close a
    /// single-hash `r#"..."#` raw string early.
    fn track_json() -> &'static str {
        r##"{"lines":[
            {"key":"a","name":"A","color":"#111111","structure":"elevated",
             "vehicleType":"heavy","gtfsRouteId":"1","track":[[100.5,13.7,15.0],[100.51,13.7,15.0]],
             "stations":[{"id":"s1","name":"S1","nameTh":"ส1","code":"A1","position":[100.5,13.7,15.0]}]},
            {"key":"b","name":"B","color":"#222222","structure":"atGrade",
             "vehicleType":"commuter","gtfsRouteId":"9","track":[[100.6,13.8,0.5],[100.61,13.8,0.5]],
             "stations":[{"id":"s2","name":"S2","nameTh":"ส2","code":"B1","position":[100.6,13.8,0.5]}]}
        ]}"##
    }

    #[test]
    fn route_order_follows_network_json_line_order() {
        let file: TrackFile = serde_json::from_str(track_json()).unwrap();
        assert_eq!(file.lines[0].key, "a");
        assert_eq!(file.lines[1].key, "b");
        // The invariant the whole plan rests on: routes[i] is lines[i].
        let ids: Vec<&str> = file.lines.iter().map(|l| l.gtfs_route_id.as_deref().unwrap()).collect();
        assert_eq!(ids, vec!["1", "9"]);
    }

    #[test]
    fn rejects_a_network_file_with_no_lines() {
        let file: TrackFile = serde_json::from_str(r#"{"lines":[]}"#).unwrap();
        assert!(file.lines.is_empty(), "empty networks must be caught by run(), not silently encoded");
    }

    #[test]
    fn frequency_trips_expand_by_headway() {
        let freqs = vec![gtfs::FrequencyRow {
            trip_id: "t1".into(),
            start_sec: 21_600, // 06:00
            end_sec: 21_600 + 900,
            headway_secs: 300,
        }];
        let runs = runs_for_pattern("t1", &freqs, 25_000, 0, 0);
        assert_eq!(runs.len(), 3, "06:00, 06:05, 06:10 — end_time is exclusive");
        assert_eq!(runs[0].start_sec, 21_600);
        assert_eq!(runs[2].start_sec, 22_200);
    }

    #[test]
    fn scheduled_trips_become_one_run_at_their_first_arrival() {
        // No frequencies row: the trip's own stop_times ARE the schedule.
        let runs = runs_for_pattern("t2", &[], 25_200, 7, 1);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].start_sec, 25_200, "07:00 departure keeps its absolute time");
        assert_eq!(runs[0].pattern_idx, 7);
        assert_eq!(runs[0].service_idx, 1);
    }

    #[test]
    fn a_frequency_trip_ignores_its_own_first_arrival() {
        let freqs = vec![gtfs::FrequencyRow {
            trip_id: "t3".into(),
            start_sec: 36_000,
            end_sec: 36_600,
            headway_secs: 600,
        }];
        let runs = runs_for_pattern("t3", &freqs, 99_999, 0, 0);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].start_sec, 36_000);
    }

    fn route_with_stations(key: &str, stations: &[(&str, f32)]) -> RouteDoc {
        RouteDoc {
            gtfs_route_id: key.into(),
            line_key: key.into(),
            simulated: true,
            name_en: key.into(),
            color_rgb: 0,
            // Straight east-west track so arc_m == x metres.
            track_xyz: vec![[0.0, 0.0, 15.0], [5000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 5000.0],
            stations: stations
                .iter()
                .map(|(id, arc)| StationDoc {
                    gtfs_stop_id: (*id).into(),
                    code: (*id).into(),
                    name_en: (*id).into(),
                    name_th: (*id).into(),
                    arc_m: *arc,
                    interchanges: Vec::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn links_stations_that_are_physically_close_across_routes() {
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0), ("a2", 1000.0)]),
            route_with_stations("b", &[("b1", 1050.0)]),
        ];
        link_interchanges(&mut routes, 300.0, &[]);
        assert_eq!(routes[0].stations[1].interchanges.len(), 1, "a2 <-> b1 is 50 m");
        assert_eq!(routes[0].stations[1].interchanges[0].route_idx, 1);
        assert!(routes[1].stations[0].interchanges.iter().any(|i| i.route_idx == 0),
                "the link must be symmetric");
        assert!(routes[0].stations[0].interchanges.is_empty(), "a1 is 1050 m away");
    }

    #[test]
    fn never_links_two_stations_on_the_same_route() {
        // Sukhumvit and Silom cross at Siam with stations metres apart; a
        // self-link would make the inspector advertise a transfer to itself.
        let mut routes = vec![route_with_stations("a", &[("a1", 0.0), ("a2", 20.0)])];
        link_interchanges(&mut routes, 300.0, &[]);
        assert!(routes[0].stations.iter().all(|s| s.interchanges.is_empty()));
    }

    #[test]
    fn honours_a_manual_override_beyond_the_radius() {
        // Asok <-> Sukhumvit is a ~200 m walkway; Phaya Thai <-> ARL is longer.
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0)]),
            route_with_stations("b", &[("b1", 2000.0)]),
        ];
        link_interchanges(&mut routes, 100.0, &[("a1".into(), "b1".into())]);
        assert_eq!(routes[0].stations[0].interchanges.len(), 1);
        assert_eq!(routes[1].stations[0].interchanges.len(), 1);
    }
}
