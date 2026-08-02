#!/usr/bin/env node
/**
 * Run a cargo command against rust-engine/ inside a Docker container.
 *
 * Why this exists: the repo's `rust:test` / `data:preprocess` scripts call
 * `cargo` directly, which is right on a machine with a working toolchain. On a
 * machine without one — or with one that crashes (a `stable-*-windows-gnu`
 * rustc that dies with 0xC0E90002 on launch, security software being the usual
 * cause) — this gives the same commands a working path with no host install.
 *
 * The cargo registry and the build target directory live in NAMED VOLUMES, not
 * on the bind mount: a target/ directory written through a Windows bind mount
 * is both very slow and prone to permission churn against the host checkout.
 * That also keeps repeat runs warm.
 *
 * Usage:
 *   node tools/cargo-docker.mjs test --manifest-path rust-engine/Cargo.toml
 *   node tools/cargo-docker.mjs run --manifest-path ... -- --gtfs /gtfs ...
 *
 * Pass `--mount-gtfs <hostDir>` (before the cargo args) to expose an extracted
 * GTFS feed to the container at /gtfs — the preprocessor's --gtfs argument
 * must then use the container path, not the host one.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const IMAGE = "rust:1-bookworm";
const REGISTRY_VOLUME = "metro-cargo-registry";
const TARGET_VOLUME = "metro-cargo-target";

const argv = process.argv.slice(2);
let gtfsDir = null;
const mountFlag = argv.indexOf("--mount-gtfs");
if (mountFlag !== -1) {
  gtfsDir = argv[mountFlag + 1];
  if (!gtfsDir) {
    console.error("--mount-gtfs needs a directory");
    process.exit(1);
  }
  argv.splice(mountFlag, 2);
}

if (argv.length === 0) {
  console.error("usage: node tools/cargo-docker.mjs [--mount-gtfs <dir>] <cargo args...>");
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..");

const args = [
  "run",
  "--rm",
  "-v",
  `${repo}:/w`,
  "-v",
  `${REGISTRY_VOLUME}:/usr/local/cargo/registry`,
  "-v",
  `${TARGET_VOLUME}:/target`,
  // Keeping the target dir off the bind mount is what makes rebuilds fast and
  // stops root-owned artefacts appearing in the host checkout.
  "-e",
  "CARGO_TARGET_DIR=/target",
  "-w",
  "/w",
];

if (gtfsDir) args.push("-v", `${resolve(gtfsDir)}:/gtfs:ro`);

args.push(IMAGE, "cargo", ...argv);

console.log(`docker ${args.join(" ")}`);
const result = spawnSync("docker", args, { stdio: "inherit" });
if (result.error) {
  console.error(`failed to run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
