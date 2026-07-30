//! Civil-date helpers (GTFS service-day resolution) and frequency expansion.

use crate::model::ServiceDoc;

/// Days since 1970-01-01 for a proleptic-Gregorian civil date.
/// Howard Hinnant's `days_from_civil` algorithm.
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let mp = (m as i64 + 9) % 12; // Mar=0 … Feb=11
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe as i64 * 365 + yoe as i64 / 4 - yoe as i64 / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Inverse of `days_from_civil`.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn split_yyyymmdd(date: u32) -> (i64, u32, u32) {
    ((date / 10_000) as i64, date / 100 % 100, date % 100)
}

pub fn join_yyyymmdd(y: i64, m: u32, d: u32) -> u32 {
    y as u32 * 10_000 + m * 100 + d
}

/// Weekday index for a YYYYMMDD date: 0=Monday … 6=Sunday.
pub fn weekday_mon0(date_yyyymmdd: u32) -> u8 {
    let (y, m, d) = split_yyyymmdd(date_yyyymmdd);
    let days = days_from_civil(y, m, d);
    // 1970-01-01 was a Thursday (Mon0 index 3).
    ((days + 3).rem_euclid(7)) as u8
}

/// The civil date one day before `date_yyyymmdd`.
pub fn previous_date(date_yyyymmdd: u32) -> u32 {
    let (y, m, d) = split_yyyymmdd(date_yyyymmdd);
    let (py, pm, pd) = civil_from_days(days_from_civil(y, m, d) - 1);
    join_yyyymmdd(py, pm, pd)
}

/// GTFS service-day resolution: calendar_dates exceptions override the
/// weekday mask + date range.
pub fn service_active_on(svc: &ServiceDoc, date_yyyymmdd: u32) -> bool {
    if svc.removed_dates.contains(&date_yyyymmdd) {
        return false;
    }
    if svc.added_dates.contains(&date_yyyymmdd) {
        return true;
    }
    if date_yyyymmdd < svc.start_date || date_yyyymmdd > svc.end_date {
        return false;
    }
    (svc.weekday_mask >> weekday_mon0(date_yyyymmdd)) & 1 == 1
}

/// Frequency expansion: run starts at `start + k*headway` while strictly
/// `< end` (contract §0/§2).
pub fn expand_frequency(start_sec: u32, end_sec: u32, headway_secs: u32) -> Vec<u32> {
    let mut out = Vec::new();
    if headway_secs == 0 {
        return out;
    }
    let mut t = start_sec;
    while t < end_sec {
        out.push(t);
        t += headway_secs;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekday_known_dates() {
        assert_eq!(weekday_mon0(20260730), 3); // 2026-07-30 is a Thursday
        assert_eq!(weekday_mon0(19700101), 3); // 1970-01-01 Thursday
        assert_eq!(weekday_mon0(20000101), 5); // 2000-01-01 Saturday
        assert_eq!(weekday_mon0(20260101), 3); // 2026-01-01 Thursday
        assert_eq!(weekday_mon0(20261231), 3); // 2026-12-31 Thursday
        assert_eq!(weekday_mon0(20240229), 3); // 2024-02-29 Thursday (leap)
    }

    #[test]
    fn previous_date_rollovers() {
        assert_eq!(previous_date(20260730), 20260729);
        assert_eq!(previous_date(20260101), 20251231);
        assert_eq!(previous_date(20260301), 20260228);
        assert_eq!(previous_date(20240301), 20240229);
    }

    fn weekday_service() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "1".into(),
            weekday_mask: 0b0001_1111, // Mon–Fri
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![],
            removed_dates: vec![20260730], // Thai holiday (real feed data)
        }
    }

    fn weekend_service() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "2".into(),
            weekday_mask: 0b0110_0000, // Sat–Sun
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![20260730], // holiday runs weekend service
            removed_dates: vec![],
        }
    }

    #[test]
    fn service_day_resolution() {
        let wd = weekday_service();
        let we = weekend_service();
        // Ordinary Wednesday.
        assert!(service_active_on(&wd, 20260722));
        assert!(!service_active_on(&we, 20260722));
        // Ordinary Saturday.
        assert!(!service_active_on(&wd, 20260725));
        assert!(service_active_on(&we, 20260725));
        // Removed holiday (Thursday): weekday service off, weekend added on.
        assert!(!service_active_on(&wd, 20260730));
        assert!(service_active_on(&we, 20260730));
        // Outside date range.
        assert!(!service_active_on(&wd, 20270101));
        assert!(!service_active_on(&wd, 20221230));
    }

    #[test]
    fn frequency_expansion_counts() {
        // 06:00–07:00 @360 s -> 10 runs (last at 06:54, 07:00 excluded).
        assert_eq!(expand_frequency(21600, 25200, 360).len(), 10);
        // 07:00–09:00 @207 s -> ceil(7200/207)=35 runs, strictly < end.
        let v = expand_frequency(25200, 32400, 207);
        assert_eq!(v.len(), 35);
        assert_eq!(v[0], 25200);
        assert!(*v.last().unwrap() < 32400);
        // Exact multiple boundary excluded: 22:00–24:00 @480 -> 15 runs.
        let v = expand_frequency(79200, 86400, 480);
        assert_eq!(v.len(), 15);
        assert_eq!(*v.last().unwrap(), 86400 - 480);
        // Degenerate inputs.
        assert!(expand_frequency(100, 100, 60).is_empty());
        assert!(expand_frequency(100, 90, 60).is_empty());
        assert!(expand_frequency(0, 100, 0).is_empty());
    }
}
