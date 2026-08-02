// Decisive MVP 3 check, data-level: sample interpolated vehicle states twice
// and assert (a) vehicles exist, (b) in-transit vehicles moved plausibly,
// (c) yaw matches direction of motion, (d) dwellers sit still.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
// Enter as a RETURNING visitor. On a fresh profile the first-run tour opens
// and deliberately blocks clicks on everything behind it, which would make
// every synthetic interaction below hit the tour instead of the app.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("metro3d.preferences.v1", JSON.stringify({ tourSeen: true }));
  } catch {
    /* storage unavailable — the tour simply shows, as it would for a user */
  }
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_000));

const sample = () =>
  page.evaluate(() => {
    const client = window.__sim?.current;
    if (!client) return null;
    const { vehicles, count } = client.getInterpolated(performance.now());
    const out = [];
    for (let i = 0; i < count; i++) {
      const b = i * 8;
      out.push({
        x: vehicles[b], y: vehicles[b + 1], z: vehicles[b + 2],
        yaw: vehicles[b + 3], state: vehicles[b + 4],
        run: vehicles[b + 5], route: vehicles[b + 6], prog: vehicles[b + 7],
      });
    }
    // Raw newest-frame poses alongside the interpolated ones: when a mover
    // looks impossible, the first question is whether the engine produced it
    // or the render-side lerp did, and only having both answers that.
    const raw = {};
    const f = client.frameB;
    if (f) {
      for (let i = 0; i < f.count; i++) {
        const k = i * 8;
          raw[f.data[k + 5]] = [f.data[k], f.data[k + 1], f.data[k + 4], f.data[k + 7]];
      }
    }
    return { count, simNow: client.getSimNow(), out, raw };
  });

const A = await sample();
await new Promise((r) => setTimeout(r, 4_000));
const B = await sample();
if (!A || !B) { console.log("FAIL: __sim handle missing"); process.exit(1); }

console.log(`count A=${A.count} B=${B.count}; sim dt = ${(B.simNow - A.simNow) / 1000}s`);
// Index by run id, but DROP any run id that appears more than once in either
// sample. The engine also evaluates the previous service day at sec+86400 to
// cover post-midnight spillover, so around the rollover the same run can be
// live twice at different points on its line. Matching those two by id alone
// paired sample A's copy with sample B's *other* copy and reported a 2 km
// "displacement" in four seconds — a measurement artifact, not a teleporting
// train, and the source of this check's intermittent failures.
const countRuns = (rows) => {
  const seen = new Map();
  for (const v of rows) seen.set(v.run, (seen.get(v.run) ?? 0) + 1);
  return seen;
};
const dupA = countRuns(A.out);
const dupB = countRuns(B.out);
const ambiguous = [...dupB.keys()].filter((r) => dupB.get(r) > 1 || (dupA.get(r) ?? 0) > 1);
if (ambiguous.length) {
  console.log(`  (skipping ${ambiguous.length} run(s) live twice via service-day spillover)`);
}
const byRunB = new Map(
  B.out.filter((v) => dupB.get(v.run) === 1 && (dupA.get(v.run) ?? 0) === 1).map((v) => [v.run, v]),
);
let moved = 0, still = 0, badYaw = 0, dwellMoved = 0, matched = 0;
let maxD = 0, minZ = Infinity, maxZ = -Infinity;
for (const a of A.out) {
  const b = byRunB.get(a.run);
  if (!b) continue;
  matched++;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  maxD = Math.max(maxD, d);
  minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, a.z);
  const inTransitEither = a.state === 1 || b.state === 1;
  if (inTransitEither && d > 5) {
    moved++;
    // heading vs displacement (use B's yaw; generous tolerance for curves)
    const headErr = Math.abs(((Math.atan2(dy, dx) - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (b.state === 1 && d > 30 && headErr > 0.6) {
      badYaw++;
      console.log("  offender:", JSON.stringify({ ...b, dispHeading: Math.atan2(dy, dx).toFixed(2), d: d.toFixed(1), headErr: headErr.toFixed(2) }));
    }
  } else if (a.state === 0 && b.state === 0) {
    still++;
    if (d > 1) dwellMoved++;
  }
}
// Name the fastest movers when the displacement gate trips. Without this a
// failure is just a number, and the number has more than one possible cause;
// the run/route/progress triple says immediately whether a train crossed a
// plausible distance quickly or slid along an implausibly long schedule leg.
// See "MRT Blue's loop" in CLAUDE.md for the known offender.
if (maxD >= 900) {
  const worst = [];
  for (const a of A.out) {
    const b = byRunB.get(a.run);
    if (!b) continue;
    const ra = A.raw[a.run];
    const rb = B.raw[b.run];
    worst.push({
      run: a.run,
      route: a.route,
      metres: Math.round(Math.hypot(b.x - a.x, b.y - a.y)),
      rawMetres: ra && rb ? Math.round(Math.hypot(rb[0] - ra[0], rb[1] - ra[1])) : null,
      progress: `${a.prog.toFixed(3)}->${b.prog.toFixed(3)}`,
      state: `${a.state.toFixed(2)}->${b.state.toFixed(2)}`,
    });
  }
  worst.sort((x, y) => y.metres - x.metres);
  console.log(`  fastest: ${JSON.stringify(worst.slice(0, 3))}`);
  // Name the schedule behind the worst mover. A number alone has more than
  // one possible cause; the stop list says at once whether the train crossed
  // a plausible distance quickly or slid along an impossible schedule leg.
  const detail = await page.evaluate(
    (run) => window.__sim.current.getRunDetail(run, window.__sim.current.getSimNow()),
    worst[0].run,
  );
  const mask = (r) => r % 1048576;
  const copies = (sampleRaw, run) =>
    Object.entries(sampleRaw)
      .filter(([k]) => mask(Number(k)) === mask(run))
      .map(([k, v]) => `${k}@[${Math.round(v[0])},${Math.round(v[1])}] st=${v[2]} pg=${v[3].toFixed(2)}`);
  console.log(`  copies in A: ${copies(A.raw, worst[0].run).join(" ; ")}`);
  console.log(`  copies in B: ${copies(B.raw, worst[0].run).join(" ; ")}`);
  console.log(`  simNow A=${A.simNow} B=${B.simNow}`);
  if (detail) {
    console.log(
      `  worst run ${worst[0].run}: ${detail.route_name} -> ${detail.headsign_en}, ` +
        `stop ${detail.current_stop_ordinal}/${detail.stops.length}`,
    );
    console.log(
      `  stops: ${detail.stops.map((s) => `${s.name_en}@${s.arrival_sec}`).join(" | ")}`.slice(0, 900),
    );
  }
}
console.log(`matched=${matched} movedInTransit=${moved} dwellStill=${still}`);
console.log(`maxDisplacement=${maxD.toFixed(1)}m  z range=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]m`);
console.log(`violations: badYaw=${badYaw} dwellMoved=${dwellMoved}`);
// Altitude bounds are SRS §F1.3's structure range (underground −12..−25,
// at-grade +0.5, elevated +12..+22), not the old "everything is elevated"
// window of 10..20 m. That window was correct through MVP 5, when every
// registered line was nominally elevated; MVP 6 added MRT Blue, whose core is
// bored tunnel at −18 m, so trains legitimately run below ground now and the
// old bound failed on real, correct data.
const withinStructureRange = minZ > -26 && maxZ < 23;
// ...and the network must actually still contain elevated track, so a data
// regression that dropped every line to one altitude can't quietly pass.
const hasElevated = maxZ > 10;
const pass =
  A.count > 20 &&
  moved > 5 &&
  badYaw === 0 &&
  dwellMoved === 0 &&
  maxD < 900 &&
  withinStructureRange &&
  hasElevated;
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
