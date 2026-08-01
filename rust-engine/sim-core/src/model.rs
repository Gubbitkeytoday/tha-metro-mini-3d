//! Binary cache model — `network.tmb` (TMB = Thai Metro Binary).
//!
//! Serialized with bincode 2 (serde integration, standard config). Exact
//! field order matters; see docs/ENGINE_CONTRACT.md §2.

use serde::{Deserialize, Serialize};

pub const TMB_MAGIC: u32 = 0x544D_4231; // "TMB1"
pub const TMB_VERSION: u16 = 2;

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheDoc {
    pub magic: u32,           // TMB_MAGIC
    pub version: u16,         // 2
    pub feed_version: String, // "20260729"
    pub generated_unix: i64,
    pub origin_lng: f64, // MUST equal frontend ORIGIN_LNG_LAT
    pub origin_lat: f64, // (100.5332, 13.7456)
    pub routes: Vec<RouteDoc>, // order == src/data/network.json `lines` order
    pub services: Vec<ServiceDoc>,
    pub patterns: Vec<PatternDoc>,
    pub runs: Vec<RunDoc>, // sorted by (service_idx, start_sec)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteDoc {
    pub gtfs_route_id: String, // "1" / "2" / "" for a track-only (unsimulated) line
    /// Registry key from tools/lines.config.mjs; ties a cache route back to
    /// its network.json geometry and its UI colour.
    pub line_key: String,
    /// false = track geometry only (no patterns, no runs, no trains).
    pub simulated: bool,
    pub name_en: String,
    pub color_rgb: u32, // always parse_hex_color(line.color) from the registry, e.g. 0x7CB342 (Sukhumvit)
    /// Track polyline in LOCAL ENU METERS relative to (origin_lng, origin_lat),
    /// Catmull-Rom resampled at ~10 m spacing by the preprocessor.
    /// x=east, y=north, z=up(+15.0). Same frame as src/map/coordinates.ts.
    pub track_xyz: Vec<[f32; 3]>,
    /// Cumulative arc length in meters, same length as track_xyz, [0]=0.
    pub track_arc_m: Vec<f32>,
    pub stations: Vec<StationDoc>, // ordered by arc_m ascending
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StationDoc {
    pub gtfs_stop_id: String,
    pub code: String, // e.g. "N8"
    pub name_en: String,
    pub name_th: String,
    /// Station snapped ONTO the track polyline: arc-length position in meters.
    pub arc_m: f32,
    /// Other routes' stations within walking distance. Symmetric, never
    /// self-referential, computed by the preprocessor (contract §2).
    pub interchanges: Vec<InterchangeRef>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct InterchangeRef {
    pub route_idx: u8,
    pub station_idx: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceDoc {
    pub gtfs_service_id: String,
    pub weekday_mask: u8, // bit0=Monday … bit6=Sunday
    pub start_date: u32,  // YYYYMMDD inclusive
    pub end_date: u32,    // YYYYMMDD inclusive
    pub added_dates: Vec<u32>,   // calendar_dates exception_type 1
    pub removed_dates: Vec<u32>, // calendar_dates exception_type 2
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternDoc {
    pub gtfs_trip_id: String,
    pub route_idx: u8, // index into routes
    pub direction: u8, // GTFS direction_id
    pub headsign_en: String,
    /// Per stop of this pattern, in sequence order:
    pub stops: Vec<PatternStop>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternStop {
    pub station_idx: u16, // index into routes[route_idx].stations
    pub arrival_s: u32,   // offset from run start (first stop = 0)
    pub departure_s: u32, // >= arrival_s (dwell)
    pub arc_m: f32,       // copy of station arc_m (denormalized for speed)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunDoc {
    pub pattern_idx: u16,
    pub service_idx: u8,
    /// Seconds after service-day midnight (< 86400; arrivals may exceed 86400).
    pub start_sec: u32,
}
