#!/usr/bin/env node
/**
 * NF2 gate: total initial payload (JS/CSS/wasm + the binary timetable) must
 * stay ≤ 5 MB compressed. Run after `npm run build`.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES = 5 * 1024 * 1024;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Vite's default `publicDir` behaviour copies `public/` verbatim into
// `dist/` on every build, so `dist/data/network.tmb` is normally a
// byte-identical copy of `public/data/network.tmb` already. Appending the
// public/ path unconditionally would double-count it (~300 KB gzip on the
// current network). Only fall back to the public/ source if the expected
// dist/ copy isn't there (e.g. copyPublicDir was ever turned off).
const distFiles = walk("dist");
const distTmbCopy = join("dist", "data", "network.tmb");
const files = distFiles.includes(distTmbCopy)
  ? distFiles
  : [...distFiles, "public/data/network.tmb"];
let total = 0;
const rows = [];
for (const f of files) {
  const gz = gzipSync(readFileSync(f)).length;
  total += gz;
  rows.push([f, gz]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [f, gz] of rows.slice(0, 12)) {
  console.log(`${(gz / 1024).toFixed(1).padStart(9)} KB  ${f}`);
}
const mb = (total / 1024 / 1024).toFixed(2);
console.log(`\ntotal gzip: ${mb} MB / 5.00 MB budget (NF2)`);
if (total > BUDGET_BYTES) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
