//! Schedule queries for the MVP 4 UI (inspector, station board, follow-cam).
//!
//! The stride-8 vehicle buffer deliberately carries pose only — everything a
//! human wants to read (headsign, origin/destination, next-station ETA, a
//! station's upcoming departures) lives in the cache and is derived here.
//!
//! These are UI-rate calls (on selection, or ~1 Hz), NOT frame-path calls, so
//! returning owned structs / JSON across the wasm boundary is fine. Nothing in
//! this module may be called per frame — see §3A.2 on boundary-crossing cost.

use serde::Serialize;

use crate::calendar::{previous_date, service_active_on};
use crate::model::{PatternDoc, RouteDoc};
use crate::world::{SimWorld, STATE_DWELL, STATE_TRANSIT};

/// One scheduled call, in seconds since the run's own service-day midnight.
#[derive(Debug, Clone, Serialize)]
pub struct StopCall {
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    /// Absolute seconds after service-day midnight (may exceed 86400).
    pub arrival_sec: u32,
    pub departure_sec: u32,
}

/// Everything the train inspector shows for one active run.
#[derive(Debug, Clone, Serialize)]
pub struct RunDetail {
    pub run_idx: u32,
    pub route_idx: u8,
    pub route_name: String,
    pub color_rgb: u32,
    pub headsign: String,
    pub direction: u8,
    pub origin: String,
    pub destination: String,
    /// 0 = dwelling, 1 = in transit — matches vehicle lane 4.
    pub state: u8,
    /// Set while dwelling.
    pub at_station: Option<String>,
    pub prev_station: Option<String>,
    pub next_station: Option<String>,
    /// Seconds until the next scheduled arrival (0 if already there).
    pub next_arrival_in_s: Option<i64>,
    /// Index into `stops` of the next call; None once terminated.
    pub next_stop_ordinal: Option<usize>,
    /// Seconds since this run's service-day midnight, at query time.
    pub now_sec: i64,
    pub stops: Vec<StopCall>,
}

/// One upcoming departure on a station board.
#[derive(Debug, Clone, Serialize)]
pub struct BoardEntry {
    pub run_idx: u32,
    pub route_idx: u8,
    pub headsign: String,
    pub destination: String,
    pub direction: u8,
    /// Seconds after the *queried* day's midnight (spillover runs go negative-
    /// adjusted into this frame, so it is directly comparable to sec_of_day).
    pub arrival_sec: i64,
    pub departure_sec: i64,
    /// Seconds from the query time until arrival; may be slightly negative for
    /// a train currently dwelling.
    pub in_s: i64,
}

/// Upcoming departures at one station.
#[derive(Debug, Clone, Serialize)]
pub struct StationBoard {
    pub route_idx: u8,
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    pub entries: Vec<BoardEntry>,
}

/// A station with its position in the local ENU meter frame, so the frontend
/// can hit-test clicks against the same indices the board query expects.
#[derive(Debug, Clone, Serialize)]
pub struct StationInfo {
    pub route_idx: u8,
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    pub arc_m: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Which service-day frame a run falls in for a given local date/time.
struct Frame {
    /// Seconds since the run's own service-day midnight.
    t_abs: f64,
    /// Offset to convert run-frame seconds into the queried day's frame.
    to_query_frame: i64,
}

impl SimWorld {
    /// Frames to test for a run: today at `sec_of_day`, and the previous
    /// service day at `sec_of_day + 86400` (post-midnight spillover) — the
    /// same two-frame rule `evaluate` uses.
    fn frames_for(&self, run_idx: usize, date_yyyymmdd: u32, sec_of_day: f64) -> Vec<Frame> {
        let run = &self.doc().runs[run_idx];
        let svc = &self.doc().services[run.service_idx as usize];
        let mut out = Vec::with_capacity(2);
        if service_active_on(svc, date_yyyymmdd) {
            out.push(Frame { t_abs: sec_of_day, to_query_frame: 0 });
        }
        if service_active_on(svc, previous_date(date_yyyymmdd)) {
            out.push(Frame { t_abs: sec_of_day + 86_400.0, to_query_frame: -86_400 });
        }
        out
    }

    fn stop_calls(&self, pattern: &PatternDoc, route: &RouteDoc, start_sec: u32) -> Vec<StopCall> {
        pattern
            .stops
            .iter()
            .map(|s| {
                let st = &route.stations[s.station_idx as usize];
                StopCall {
                    station_idx: s.station_idx,
                    code: st.code.clone(),
                    name_en: st.name_en.clone(),
                    name_th: st.name_th.clone(),
                    arrival_sec: start_sec + s.arrival_s,
                    departure_sec: start_sec + s.departure_s,
                }
            })
            .collect()
    }

    /// Detail for one run at a local Bangkok date/time. `None` when the run is
    /// not active then (never started, already finished, service inactive) —
    /// the same liveness rule `evaluate` applies, so a selected train that
    /// vanishes from the buffer also returns None here.
    pub fn run_detail(
        &self,
        run_idx: u32,
        date_yyyymmdd: u32,
        sec_of_day: f64,
    ) -> Option<RunDetail> {
        let idx = run_idx as usize;
        let doc = self.doc();
        let run = doc.runs.get(idx)?;
        let pattern = &doc.patterns[run.pattern_idx as usize];
        let route = &doc.routes[pattern.route_idx as usize];
        let last = pattern.stops.last()?;
        let dur = last.arrival_s as f64;

        // First frame in which the run is live.
        let frame = self
            .frames_for(idx, date_yyyymmdd, sec_of_day)
            .into_iter()
            .find(|f| {
                let t = f.t_abs - run.start_sec as f64;
                t >= 0.0 && t <= dur
            })?;
        let t = frame.t_abs - run.start_sec as f64;

        let stops = self.stop_calls(pattern, route, run.start_sec);
        let name_of = |i: usize| stops[i].name_en.clone();

        // Last stop whose arrival is <= t (mirrors eval_pattern).
        let i = pattern.stops.partition_point(|s| (s.arrival_s as f64) <= t);
        let cur = i.saturating_sub(1);
        let dwelling = t <= pattern.stops[cur].departure_s as f64;

        let (at_station, prev_station, next_stop_ordinal) = if dwelling {
            (
                Some(name_of(cur)),
                if cur > 0 { Some(name_of(cur - 1)) } else { None },
                if cur + 1 < stops.len() { Some(cur + 1) } else { None },
            )
        } else {
            (None, Some(name_of(cur)), Some(cur + 1).filter(|&n| n < stops.len()))
        };

        let next_arrival_in_s = next_stop_ordinal
            .map(|n| stops[n].arrival_sec as i64 - (run.start_sec as i64 + t as i64));

        Some(RunDetail {
            run_idx,
            route_idx: pattern.route_idx,
            route_name: route.name_en.clone(),
            color_rgb: route.color_rgb,
            headsign: pattern.headsign_en.clone(),
            direction: pattern.direction,
            origin: stops.first().map(|s| s.name_en.clone()).unwrap_or_default(),
            destination: stops.last().map(|s| s.name_en.clone()).unwrap_or_default(),
            state: if dwelling { STATE_DWELL as u8 } else { STATE_TRANSIT as u8 },
            at_station,
            prev_station,
            next_station: next_stop_ordinal.map(name_of),
            next_arrival_in_s,
            next_stop_ordinal,
            now_sec: run.start_sec as i64 + t as i64,
            stops,
        })
    }

    /// Upcoming calls at one station, soonest first, at most `limit` entries.
    /// Includes a train currently dwelling there (`in_s` slightly negative).
    pub fn station_board(
        &self,
        route_idx: u8,
        station_idx: u16,
        date_yyyymmdd: u32,
        sec_of_day: f64,
        limit: usize,
    ) -> Option<StationBoard> {
        let doc = self.doc();
        let route = doc.routes.get(route_idx as usize)?;
        let station = route.stations.get(station_idx as usize)?;
        /// Keep a call visible for this long after it is due, so a dwelling
        /// train does not disappear off the top of the board.
        const GRACE_S: i64 = 90;

        let mut entries: Vec<BoardEntry> = Vec::new();
        for (idx, run) in doc.runs.iter().enumerate() {
            let pattern = &doc.patterns[run.pattern_idx as usize];
            if pattern.route_idx != route_idx {
                continue;
            }
            let Some(stop) = pattern.stops.iter().find(|s| s.station_idx == station_idx) else {
                continue;
            };
            for frame in self.frames_for(idx, date_yyyymmdd, sec_of_day) {
                // Into the queried day's frame so times are comparable.
                let arrival = (run.start_sec + stop.arrival_s) as i64 + frame.to_query_frame;
                let departure = (run.start_sec + stop.departure_s) as i64 + frame.to_query_frame;
                let in_s = arrival - sec_of_day as i64;
                if in_s < -GRACE_S {
                    continue;
                }
                entries.push(BoardEntry {
                    run_idx: idx as u32,
                    route_idx,
                    headsign: pattern.headsign_en.clone(),
                    destination: pattern
                        .stops
                        .last()
                        .map(|s| route.stations[s.station_idx as usize].name_en.clone())
                        .unwrap_or_default(),
                    direction: pattern.direction,
                    arrival_sec: arrival,
                    departure_sec: departure,
                    in_s,
                });
            }
        }
        entries.sort_by_key(|e| e.in_s);
        entries.truncate(limit);

        Some(StationBoard {
            route_idx,
            station_idx,
            code: station.code.clone(),
            name_en: station.name_en.clone(),
            name_th: station.name_th.clone(),
            entries,
        })
    }

    /// Every station with its ENU position, for click hit-testing. Indices
    /// match those `station_board` expects.
    pub fn stations(&self) -> Vec<StationInfo> {
        let mut out = Vec::new();
        for (route_idx, route) in self.doc().routes.iter().enumerate() {
            for (station_idx, st) in route.stations.iter().enumerate() {
                let [x, y, z] = crate::world::position_at_arc(route, st.arc_m);
                out.push(StationInfo {
                    route_idx: route_idx as u8,
                    station_idx: station_idx as u16,
                    code: st.code.clone(),
                    name_en: st.name_en.clone(),
                    name_th: st.name_th.clone(),
                    arc_m: st.arc_m,
                    x,
                    y,
                    z,
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::world::SimWorld;

    /// Same synthetic feed the world tests use (A→B→C, plus a reverse run and
    /// a run that spills past midnight).
    fn world() -> SimWorld {
        SimWorld::from_doc(crate::world::tests_support::synthetic_doc()).unwrap()
    }

    const WED: u32 = 20260722;
    const THU_HOLIDAY: u32 = 20260730;

    #[test]
    fn run_detail_dwelling_and_transit() {
        let w = world();
        // Run 0 starts 36000: A arr 0 dep 30, B arr 100 dep 130, C arr 200.
        let d = w.run_detail(0, WED, 36_010.0).expect("dwelling at A");
        assert_eq!(d.state, 0);
        assert_eq!(d.at_station.as_deref(), Some("A"));
        assert_eq!(d.prev_station, None, "first stop has no previous");
        assert_eq!(d.next_station.as_deref(), Some("B"));
        assert_eq!(d.next_arrival_in_s, Some(90));
        assert_eq!(d.origin, "A");
        assert_eq!(d.destination, "C");
        assert_eq!(d.stops.len(), 3);
        assert_eq!(d.stops[1].arrival_sec, 36_100);

        let d = w.run_detail(0, WED, 36_065.0).expect("in transit A->B");
        assert_eq!(d.state, 1);
        assert_eq!(d.at_station, None);
        assert_eq!(d.prev_station.as_deref(), Some("A"));
        assert_eq!(d.next_station.as_deref(), Some("B"));
        assert_eq!(d.next_arrival_in_s, Some(35));
    }

    #[test]
    fn run_detail_matches_evaluate_liveness() {
        let w = world();
        // Before start, after final arrival, and on a removed holiday: no
        // detail — exactly when evaluate() emits no vehicle.
        assert!(w.run_detail(0, WED, 35_999.0).is_none());
        assert!(w.run_detail(0, WED, 36_200.1).is_none());
        assert!(w.run_detail(0, THU_HOLIDAY, 36_010.0).is_none());
        // Terminus: at the final arrival there is no next station.
        let d = w.run_detail(0, WED, 36_200.0).expect("at final arrival");
        assert_eq!(d.next_station, None);
        assert_eq!(d.next_arrival_in_s, None);
        assert_eq!(d.at_station.as_deref(), Some("C"));
    }

    #[test]
    fn run_detail_follows_post_midnight_spillover() {
        let w = world();
        // Run 2 starts Wed 23:59:10 and runs 200 s into Thursday.
        let d = w.run_detail(2, 20260723, 40.0).expect("spillover run");
        assert_eq!(d.state, 1);
        assert_eq!(d.run_idx, 2);
        // Previous day is the removed holiday -> not live.
        assert!(w.run_detail(2, 20260731, 40.0).is_none());
    }

    #[test]
    fn station_board_orders_by_time_and_limits() {
        let w = world();
        // At B (station_idx 1) just before 10:00: run 0 calls at 36100,
        // run 1 (reverse, starts at B) calls at 36000.
        let b = w.station_board(0, 1, WED, 35_900.0, 10).expect("board");
        assert_eq!(b.name_en, "B");
        let times: Vec<i64> = b.entries.iter().map(|e| e.in_s).collect();
        assert!(times.windows(2).all(|w| w[0] <= w[1]), "sorted: {times:?}");
        assert!(b.entries.iter().any(|e| e.run_idx == 0));
        assert!(b.entries.iter().any(|e| e.run_idx == 1));
        // in_s is relative to the query time.
        let e0 = b.entries.iter().find(|e| e.run_idx == 0).unwrap();
        assert_eq!(e0.in_s, 200);
        assert_eq!(e0.destination, "C");

        // limit truncates to the soonest.
        let b = w.station_board(0, 1, WED, 35_900.0, 1).unwrap();
        assert_eq!(b.entries.len(), 1);
        assert_eq!(b.entries[0].run_idx, 1, "soonest first");
    }

    #[test]
    fn station_board_drops_departed_but_keeps_dwelling() {
        let w = world();
        // Run 0 arrives B at 36100, departs 36130. Query at 36120: still shown
        // (in_s = -20, inside the grace window) because it is sitting there.
        let b = w.station_board(0, 1, WED, 36_120.0, 10).unwrap();
        assert!(b.entries.iter().any(|e| e.run_idx == 0), "dwelling train kept");
        // Long past: gone.
        let b = w.station_board(0, 1, WED, 40_000.0, 10).unwrap();
        assert!(!b.entries.iter().any(|e| e.run_idx == 0));
        // Inactive service day -> empty board, not an error.
        let b = w.station_board(0, 1, THU_HOLIDAY, 35_900.0, 10).unwrap();
        assert!(b.entries.is_empty());
    }

    #[test]
    fn stations_positions_match_track() {
        let w = world();
        let s = w.stations();
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].name_en, "A");
        // Station B sits at arc 100 -> (100, 0, 15) on the synthetic track.
        let b = &s[1];
        assert!((b.x - 100.0).abs() < 1e-3 && b.y.abs() < 1e-3 && (b.z - 15.0).abs() < 1e-3);
        assert_eq!(b.station_idx, 1);
        assert_eq!(b.route_idx, 0);
    }

    #[test]
    fn out_of_range_indices_return_none() {
        let w = world();
        assert!(w.run_detail(9_999, WED, 36_010.0).is_none());
        assert!(w.station_board(9, 0, WED, 36_010.0, 5).is_none());
        assert!(w.station_board(0, 999, WED, 36_010.0, 5).is_none());
    }
}
