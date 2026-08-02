#!/usr/bin/env node
/**
 * Build the Wasm engine inside Docker, for the same reason `cargo-docker.mjs`
 * exists: this machine's native rustc dies on launch, so wasm-pack cannot run
 * on the host at all.
 *
 * Differences from the cargo wrapper, both forced by wasm-pack:
 *
 * - wasm-pack is not in `rust:1-bookworm`, so it is installed on first use
 *   into a named volume mounted at `/usr/local/cargo/bin` and reused after
 *   that. Installing it into the image layer instead would mean rebuilding a
 *   custom image, and installing it per run costs several minutes each time.
 * - the output goes to `src/sim/pkg/`, which is ON the bind mount and IS
 *   committed — that is the whole point, since it is what lets `npm run dev`
 *   work on a machine with no Rust toolchain.
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const IMAGE = "rust:1-bookworm";
const REGISTRY_VOLUME = "metro-cargo-registry";
const TARGET_VOLUME = "metro-cargo-target";
const BIN_VOLUME = "metro-cargo-bin";

const repo = resolve(import.meta.dirname, "..");

// `cargo install` is a no-op when the binary is already in the volume, so this
// one line covers both the first run and every run after it.
const script = [
  "set -e",
  "export PATH=/usr/local/cargo/bin:$PATH",
  "command -v wasm-pack >/dev/null || cargo install wasm-pack --version 0.13.1 --locked",
  "rustup target add wasm32-unknown-unknown",
  "wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg",
].join("\n");

const args = [
  "run",
  "--rm",
  "-v",
  `${repo}:/w`,
  "-v",
  `${REGISTRY_VOLUME}:/usr/local/cargo/registry`,
  "-v",
  `${TARGET_VOLUME}:/target`,
  "-v",
  `${BIN_VOLUME}:/usr/local/cargo/bin`,
  "-e",
  "CARGO_TARGET_DIR=/target",
  "-w",
  "/w",
  IMAGE,
  "bash",
  "-lc",
  script,
];

console.log(`docker ${args.join(" ")}\n`);
const result = spawnSync("docker", args, { stdio: "inherit" });
if (result.error) {
  console.error(`could not run docker: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

// wasm-pack writes a .gitignore containing `*` into its output directory,
// which would silently un-commit the very artefact this build exists to
// produce (see CLAUDE.md).
const ignore = resolve(repo, "src/sim/pkg/.gitignore");
if (existsSync(ignore)) {
  rmSync(ignore);
  console.log("removed src/sim/pkg/.gitignore (it would un-commit the build)");
}
