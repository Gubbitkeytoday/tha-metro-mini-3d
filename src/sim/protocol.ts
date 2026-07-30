/**
 * Worker protocol + flat vehicle-buffer layout (ENGINE_CONTRACT.md §3/§5).
 * These constants MUST mirror rust-engine/sim-core exactly.
 */

/** f32 lanes per vehicle record. */
export const VEHICLE_STRIDE = 8;
export const MAX_VEHICLES = 512;

/** Floats / bytes per frame buffer. */
export const FRAME_FLOATS = MAX_VEHICLES * VEHICLE_STRIDE;
export const FRAME_BYTES = FRAME_FLOATS * 4;

// Vehicle record lanes (contract §3 table).
export const LANE_X = 0; // east meters (local ENU frame)
export const LANE_Y = 1; // north meters
export const LANE_Z = 2; // up meters
export const LANE_YAW = 3; // radians CCW from +x (east), direction of travel
export const LANE_STATE = 4; // 0 = dwelling, 1 = in transit
export const LANE_RUN_IDX = 5; // index into CacheDoc.runs
export const LANE_ROUTE_IDX = 6; // 0 = Sukhumvit, 1 = Silom
export const LANE_PROGRESS = 7; // 0..1 smoothed leg progress

/** Parsed + camelCased form of Engine.validation_json() (contract §7 DoD). */
export interface ValidationSummary {
  feedVersion: string;
  routes: number;
  stations: number;
  patterns: number;
  runs: number;
  services: number;
}

/** Raw snake_case shape emitted by the Rust side; the worker maps it. */
export interface ValidationSummaryRaw {
  feed_version: string;
  routes: number;
  stations: number;
  patterns: number;
  runs: number;
  services: number;
}

// Main -> worker. NOTE deviation from contract §5: `wasmUrl` is dropped from
// "init" — the worker statically imports the pkg, so the .wasm URL resolves
// via the pkg's own `new URL("metro_sim_wasm_bg.wasm", import.meta.url)`.
export type MainToWorker =
  | { kind: "init"; cache: ArrayBuffer } // cache transferred
  | { kind: "clock"; epochMs: number; warp: number } // set/replace clock
  | { kind: "returnBuffer"; buffer: ArrayBuffer } // recycle (transferred)
  | { kind: "stop" };

// Worker -> main.
export type WorkerToMain =
  | { kind: "ready"; validation: ValidationSummary }
  | { kind: "error"; message: string }
  | { kind: "frame"; simEpochMs: number; count: number; buffer: ArrayBuffer }; // transferred
