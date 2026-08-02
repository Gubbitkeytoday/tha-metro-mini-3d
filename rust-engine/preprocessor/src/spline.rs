//! Centripetal Catmull-Rom resampling of the OSM track polyline.

type P3 = [f64; 3];

fn dist(a: P3, b: P3) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

fn lerp(a: P3, b: P3, t: f64) -> P3 {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Barry-Goldman recursive evaluation of one Catmull-Rom segment at knot `t`.
fn cr_point(p: [P3; 4], k: [f64; 4], t: f64) -> P3 {
    let a1 = lerp(p[0], p[1], (t - k[0]) / (k[1] - k[0]));
    let a2 = lerp(p[1], p[2], (t - k[1]) / (k[2] - k[1]));
    let a3 = lerp(p[2], p[3], (t - k[2]) / (k[3] - k[2]));
    let b1 = lerp(a1, a2, (t - k[0]) / (k[2] - k[0]));
    let b2 = lerp(a2, a3, (t - k[1]) / (k[3] - k[1]));
    lerp(b1, b2, (t - k[1]) / (k[2] - k[1]))
}

/// Resamples `pts` through a centripetal (alpha = 0.5) Catmull-Rom spline at
/// approximately `spacing` meters of arc length. Returns the resampled
/// polyline (first and last input points preserved).
pub fn catmull_rom_resample(pts: &[P3], spacing: f64) -> Result<Vec<P3>, String> {
    // Drop consecutive duplicates (would produce zero knot intervals).
    let mut ctrl: Vec<P3> = Vec::with_capacity(pts.len());
    for &p in pts {
        if ctrl.last().map_or(true, |&q| dist(p, q) > 1e-9) {
            ctrl.push(p);
        }
    }
    if ctrl.len() < 2 {
        return Err("track polyline has fewer than 2 distinct points".into());
    }

    // Dense sampling of the spline (max ~2 m chords), then uniform resample.
    let n = ctrl.len();
    let phantom_start = lerp(ctrl[0], ctrl[1], -1.0); // extrapolated end tangents
    let phantom_end = lerp(ctrl[n - 2], ctrl[n - 1], 2.0);
    let mut dense: Vec<P3> = vec![ctrl[0]];
    for i in 0..n - 1 {
        let p0 = if i == 0 { phantom_start } else { ctrl[i - 1] };
        let p1 = ctrl[i];
        let p2 = ctrl[i + 1];
        let p3 = if i + 2 < n { ctrl[i + 2] } else { phantom_end };
        let k0 = 0.0;
        let k1 = k0 + dist(p0, p1).sqrt(); // centripetal: alpha = 0.5
        let k2 = k1 + dist(p1, p2).sqrt();
        let k3 = k2 + dist(p2, p3).sqrt();
        let steps = ((dist(p1, p2) / 2.0).ceil() as usize).max(1);
        for s in 1..=steps {
            let t = k1 + (k2 - k1) * (s as f64) / (steps as f64);
            dense.push(cr_point([p0, p1, p2, p3], [k0, k1, k2, k3], t));
        }
    }

    // Cumulative arc of the dense polyline.
    let mut arc = vec![0.0f64; dense.len()];
    for i in 1..dense.len() {
        arc[i] = arc[i - 1] + dist(dense[i - 1], dense[i]);
    }
    let total = *arc.last().unwrap();
    if total <= spacing {
        return Ok(vec![dense[0], *dense.last().unwrap()]);
    }

    // Uniform resample at `spacing`, keeping the exact endpoint.
    let mut out: Vec<P3> = Vec::with_capacity((total / spacing) as usize + 2);
    let mut j = 0usize;
    let mut s = 0.0f64;
    while s < total - spacing * 0.5 {
        while j + 1 < arc.len() && arc[j + 1] < s {
            j += 1;
        }
        let seg = arc[j + 1] - arc[j];
        let u = if seg > 0.0 { (s - arc[j]) / seg } else { 0.0 };
        out.push(lerp(dense[j], dense[j + 1], u));
        s += spacing;
    }
    out.push(*dense.last().unwrap());
    Ok(out)
}

/// Every place along the polyline that comes within `max_d` of `p`, as
/// `(arc_m, distance_m)` ordered by arc.
///
/// A single nearest point is the wrong answer on a line that passes the same
/// platform twice. MRT Blue is a loop that serves Tha Phra once on the circle
/// and once on the Lak Song arm, and the whole route is stitched into one open
/// polyline — so snapping that stop to its *nearest* arc position gave every
/// pattern using the other Tha Phra a leg measured the long way round the
/// circle (38.3 km against a scheduled 150 s, i.e. a train sliding the length
/// of the line at ~900 km/h). Keeping all the candidates lets the pattern
/// builder pick, per trip, the one that keeps its legs short.
///
/// "Comes within `max_d`" is evaluated as contiguous runs of segments whose
/// closest approach is under the threshold; each run contributes its own
/// minimum. That way one platform passed once yields exactly one candidate,
/// however many resampled segments it spans.
pub fn snap_candidates(poly: &[P3], arc: &[f64], p: [f64; 2], max_d: f64) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::new();
    let max_d2 = max_d * max_d;
    let mut run: Option<(f64, f64)> = None; // (arc, d2) best within the current run
    for i in 0..poly.len().saturating_sub(1) {
        let (a, d2) = closest_on_segment(poly, arc, i, p);
        if d2 <= max_d2 {
            match run {
                Some((_, best)) if best <= d2 => {}
                _ => run = Some((a, d2)),
            }
        } else if let Some((a, d2)) = run.take() {
            out.push((a, d2.sqrt()));
        }
    }
    if let Some((a, d2)) = run {
        out.push((a, d2.sqrt()));
    }
    out
}

/// Closest point to `p` on segment `i`, as `(arc_m, distance_squared)`.
fn closest_on_segment(poly: &[P3], arc: &[f64], i: usize, p: [f64; 2]) -> (f64, f64) {
    let ax = poly[i][0];
    let ay = poly[i][1];
    let abx = poly[i + 1][0] - ax;
    let aby = poly[i + 1][1] - ay;
    let len2 = abx * abx + aby * aby;
    let t = if len2 > 0.0 {
        (((p[0] - ax) * abx + (p[1] - ay) * aby) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let dx = p[0] - (ax + abx * t);
    let dy = p[1] - (ay + aby * t);
    (arc[i] + (arc[i + 1] - arc[i]) * t, dx * dx + dy * dy)
}

/// Nearest point on the polyline (2D, x/y) to `p`.
/// Returns (arc_m, distance_m).
pub fn snap_to_polyline(poly: &[P3], arc: &[f64], p: [f64; 2]) -> (f64, f64) {
    let mut best_arc = 0.0;
    let mut best_d2 = f64::INFINITY;
    for i in 0..poly.len() - 1 {
        let ax = poly[i][0];
        let ay = poly[i][1];
        let bx = poly[i + 1][0];
        let by = poly[i + 1][1];
        let abx = bx - ax;
        let aby = by - ay;
        let len2 = abx * abx + aby * aby;
        let t = if len2 > 0.0 {
            (((p[0] - ax) * abx + (p[1] - ay) * aby) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let qx = ax + abx * t;
        let qy = ay + aby * t;
        let dx = p[0] - qx;
        let dy = p[1] - qy;
        let d2 = dx * dx + dy * dy;
        if d2 < best_d2 {
            best_d2 = d2;
            best_arc = arc[i] + (arc[i + 1] - arc[i]) * t;
        }
    }
    (best_arc, best_d2.sqrt())
}

pub fn cumulative_arc(poly: &[P3]) -> Vec<f64> {
    let mut arc = vec![0.0f64; poly.len()];
    for i in 1..poly.len() {
        arc[i] = arc[i - 1] + dist(poly[i - 1], poly[i]);
    }
    arc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_straight_line_spacing() {
        let pts = vec![[0.0, 0.0, 15.0], [50.0, 0.0, 15.0], [100.0, 0.0, 15.0]];
        let out = catmull_rom_resample(&pts, 10.0).unwrap();
        let arc = cumulative_arc(&out);
        let total = *arc.last().unwrap();
        assert!((total - 100.0).abs() < 0.5, "total {total}");
        // Spacing approximately 10 m everywhere except possibly the last step.
        for w in arc.windows(2).take(arc.len() - 2) {
            assert!((w[1] - w[0] - 10.0).abs() < 0.5);
        }
        assert_eq!(out.first().unwrap()[0], 0.0);
        assert!((out.last().unwrap()[0] - 100.0).abs() < 1e-9);
    }

    #[test]
    fn a_platform_passed_once_yields_exactly_one_candidate() {
        // Many resampled segments run within the threshold; they are one
        // approach, not one candidate each.
        let poly: Vec<P3> = (0..=100).map(|i| [i as f64, 0.0, 0.0]).collect();
        let arc = cumulative_arc(&poly);
        let got = snap_candidates(&poly, &arc, [50.0, 3.0], 20.0);
        assert_eq!(got.len(), 1, "{got:?}");
        assert!((got[0].0 - 50.0).abs() < 1e-9);
        assert!((got[0].1 - 3.0).abs() < 1e-9);
    }

    #[test]
    fn a_loop_passing_the_same_place_twice_yields_both_positions() {
        // Out along y=0 and back along y=8: a platform between the two tracks
        // is close to the line twice, and the whole point is to keep both.
        let mut poly: Vec<P3> = (0..=100).map(|i| [i as f64, 0.0, 0.0]).collect();
        poly.extend((0..=100).rev().map(|i| [i as f64, 8.0, 0.0]));
        let arc = cumulative_arc(&poly);
        let got = snap_candidates(&poly, &arc, [50.0, 4.0], 10.0);
        assert_eq!(got.len(), 2, "{got:?}");
        assert!(got[0].0 < got[1].0, "ordered by arc: {got:?}");
        assert!((got[0].1 - 4.0).abs() < 1e-6 && (got[1].1 - 4.0).abs() < 1e-6, "{got:?}");
    }

    #[test]
    fn a_position_past_the_threshold_is_not_a_candidate() {
        let mut poly: Vec<P3> = (0..=100).map(|i| [i as f64, 0.0, 0.0]).collect();
        poly.extend((0..=100).rev().map(|i| [i as f64, 400.0, 0.0]));
        let arc = cumulative_arc(&poly);
        let got = snap_candidates(&poly, &arc, [50.0, 5.0], 40.0);
        assert_eq!(got.len(), 1, "{got:?}");
    }

    #[test]
    fn the_best_candidate_agrees_with_the_plain_nearest_snap() {
        let poly = vec![[0.0, 0.0, 0.0], [100.0, 0.0, 0.0], [100.0, 100.0, 0.0]];
        let arc = cumulative_arc(&poly);
        let (a, d) = snap_to_polyline(&poly, &arc, [104.0, 60.0]);
        let got = snap_candidates(&poly, &arc, [104.0, 60.0], 150.0);
        let best = got.iter().cloned().fold((0.0, f64::INFINITY), |acc, c| {
            if c.1 < acc.1 { c } else { acc }
        });
        assert!((best.0 - a).abs() < 1e-9 && (best.1 - d).abs() < 1e-9, "{got:?}");
    }

    #[test]
    fn snap_projects_onto_segment() {
        let poly = vec![[0.0, 0.0, 0.0], [100.0, 0.0, 0.0], [100.0, 100.0, 0.0]];
        let arc = cumulative_arc(&poly);
        let (a, d) = snap_to_polyline(&poly, &arc, [30.0, 4.0]);
        assert!((a - 30.0).abs() < 1e-9);
        assert!((d - 4.0).abs() < 1e-9);
        let (a, d) = snap_to_polyline(&poly, &arc, [104.0, 60.0]);
        assert!((a - 160.0).abs() < 1e-9);
        assert!((d - 4.0).abs() < 1e-9);
    }
}
