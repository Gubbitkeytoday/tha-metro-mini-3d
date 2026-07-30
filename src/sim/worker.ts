import init, { Engine } from "./pkg/metro_sim_wasm";
import {
  FRAME_BYTES,
  type MainToWorker,
  type ValidationSummary,
  type ValidationSummaryRaw,
  type WorkerToMain,
} from "./protocol";

/**
 * Dedicated module worker running the wasm sim engine (ENGINE_CONTRACT.md §5).
 *
 * Fixed-cadence loop at 10 Hz REAL time; each tick evaluates the schedule at
 * the current warped sim time and posts a transferable frame buffer from a
 * fixed ping-pong pool (never allocates unboundedly, never blocks). The main
 * thread interpolates between frames at render time (SRS §3A.7).
 */

const TICK_MS = 100; // 10 Hz
const POOL_SIZE = 3;
/** Asia/Bangkok is fixed UTC+7, no DST — a constant offset is exact. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

let engine: Engine | null = null;
let timer: number | null = null;
const pool: ArrayBuffer[] = [];

// Sim clock: simEpochMs = clockEpochMs + (performance.now() - clockSetAt) * warp.
// The main thread rebases epochMs on warp change so sim time stays continuous.
let clockEpochMs = Date.now();
let clockSetAt = performance.now();
let warp = 1;

// lib.dom types `self` as Window whose postMessage lacks the plain
// (message, transfer[]) worker overload — cast once here.
const post = (msg: WorkerToMain, transfer: Transferable[] = []): void =>
  (self as unknown as { postMessage(m: WorkerToMain, t?: Transferable[]): void }).postMessage(
    msg,
    transfer,
  );

function tick(): void {
  if (!engine) return;
  const buffer = pool.pop();
  if (!buffer) return; // pool exhausted (main hasn't returned buffers) — skip tick

  const simEpochMs = clockEpochMs + (performance.now() - clockSetAt) * warp;
  // Shift to Bangkok local, then read the wall-clock fields with UTC getters.
  const local = new Date(simEpochMs + BANGKOK_OFFSET_MS);
  const dateYyyymmdd =
    local.getUTCFullYear() * 10_000 + (local.getUTCMonth() + 1) * 100 + local.getUTCDate();
  const secOfDay =
    local.getUTCHours() * 3600 +
    local.getUTCMinutes() * 60 +
    local.getUTCSeconds() +
    local.getUTCMilliseconds() / 1000;

  const count = engine.evaluate(dateYyyymmdd, secOfDay, new Float32Array(buffer));
  post({ kind: "frame", simEpochMs, count, buffer }, [buffer]);
}

async function handleInit(cache: ArrayBuffer): Promise<void> {
  try {
    await init(); // wasm URL resolves inside the pkg via import.meta.url
    engine = new Engine(new Uint8Array(cache));
    const raw = JSON.parse(engine.validation_json()) as ValidationSummaryRaw;
    const validation: ValidationSummary = {
      feedVersion: raw.feed_version,
      routes: raw.routes,
      stations: raw.stations,
      patterns: raw.patterns,
      runs: raw.runs,
      services: raw.services,
    };
    for (let i = 0; i < POOL_SIZE; i++) pool.push(new ArrayBuffer(FRAME_BYTES));
    timer = setInterval(tick, TICK_MS);
    post({ kind: "ready", validation });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  switch (msg.kind) {
    case "init":
      void handleInit(msg.cache);
      break;
    case "clock":
      clockEpochMs = msg.epochMs;
      warp = msg.warp;
      clockSetAt = performance.now();
      break;
    case "returnBuffer":
      pool.push(msg.buffer);
      break;
    case "stop":
      if (timer !== null) clearInterval(timer);
      timer = null;
      engine?.free();
      engine = null;
      self.close();
      break;
  }
};
