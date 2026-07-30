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
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60_000 });
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
    return { count, simNow: client.getSimNow(), out };
  });

const A = await sample();
await new Promise((r) => setTimeout(r, 4_000));
const B = await sample();
if (!A || !B) { console.log("FAIL: __sim handle missing"); process.exit(1); }

console.log(`count A=${A.count} B=${B.count}; sim dt = ${(B.simNow - A.simNow) / 1000}s`);
const byRunB = new Map(B.out.map((v) => [v.run, v]));
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
console.log(`matched=${matched} movedInTransit=${moved} dwellStill=${still}`);
console.log(`maxDisplacement=${maxD.toFixed(1)}m  z range=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]m`);
console.log(`violations: badYaw=${badYaw} dwellMoved=${dwellMoved}`);
const pass = A.count > 20 && moved > 5 && badYaw === 0 && dwellMoved === 0 && maxD < 900 && minZ > 10 && maxZ < 20;
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
