import {
  FRAME_FLOATS,
  LANE_RUN_IDX,
  LANE_YAW,
  MAX_VEHICLES,
  VEHICLE_STRIDE,
  type MainToWorker,
  type ValidationSummary,
  type WorkerToMain,
} from "./protocol";

/**
 * Main-thread wrapper around the sim worker (ENGINE_CONTRACT.md §5).
 *
 * Owns the worker lifecycle, the transferable frame-buffer ping-pong, the
 * warp-rebased sim clock, and render-side interpolation between the two most
 * recent frames. Per-frame data never touches React/Zustand — the render loop
 * calls getInterpolated() directly (SRS §3A.7).
 */

export interface ClockParams {
  clockEpochMs: number;
  clockSetAt: number; // performance.now() timestamp on the MAIN thread
  warp: number;
}

export interface SimClientCallbacks {
  onReady?: (validation: ValidationSummary) => void;
  onError?: (message: string) => void;
  /** Fired per worker frame (10 Hz) — throttle before touching UI state. */
  onFrame?: (simEpochMs: number, count: number) => void;
  /** Fired whenever the clock is (re)based — mirror the params into Zustand. */
  onClock?: (params: ClockParams) => void;
}

interface Frame {
  simEpochMs: number;
  count: number;
  data: Float32Array;
  /** run_idx -> record offset, built lazily for cross-frame matching. */
  byRun: Map<number, number>;
}

const TWO_PI = Math.PI * 2;

/** Shortest-arc angular delta from a to b, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

function indexFrame(data: Float32Array, count: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    map.set(data[i * VEHICLE_STRIDE + LANE_RUN_IDX], i * VEHICLE_STRIDE);
  }
  return map;
}

/**
 * Handle to the live SimClient for UI event handlers (TimeControls). Set by
 * MapContainer; null while the engine is down.
 */
export const activeSimClient: { current: SimClient | null } = { current: null };

export class SimClient {
  private worker: Worker;
  private frameA: Frame | null = null; // older
  private frameB: Frame | null = null; // newer
  private clock: ClockParams = { clockEpochMs: Date.now(), clockSetAt: performance.now(), warp: 1 };
  /** Reused output of getInterpolated(). */
  private outVehicles = new Float32Array(FRAME_FLOATS);
  private disposed = false;

  constructor(private callbacks: SimClientCallbacks = {}) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => this.onMessage(event.data);
    this.worker.onerror = (event) => this.callbacks.onError?.(event.message || "worker error");
    void this.load();
  }

  private post(msg: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch("/data/green-line.tmb");
      if (!res.ok) throw new Error(`green-line.tmb: HTTP ${res.status}`);
      const cache = await res.arrayBuffer();
      if (this.disposed) return;
      this.post({ kind: "init", cache }, [cache]);
      this.setClock(Date.now(), 1);
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  private onMessage(msg: WorkerToMain): void {
    switch (msg.kind) {
      case "ready":
        this.callbacks.onReady?.(msg.validation);
        break;
      case "error":
        this.callbacks.onError?.(msg.message);
        break;
      case "frame":
        this.acceptFrame(msg.simEpochMs, msg.count, msg.buffer);
        this.callbacks.onFrame?.(msg.simEpochMs, msg.count);
        break;
    }
  }

  private acceptFrame(simEpochMs: number, count: number, buffer: ArrayBuffer): void {
    const data = new Float32Array(buffer);
    const frame: Frame = { simEpochMs, count, data, byRun: indexFrame(data, count) };
    // Clock was rebased backwards (e.g. "Now" reset): drop stale frames.
    if (this.frameB && simEpochMs <= this.frameB.simEpochMs) {
      if (this.frameA) this.recycle(this.frameA);
      this.recycle(this.frameB);
      this.frameA = null;
      this.frameB = frame;
      return;
    }
    if (this.frameA) this.recycle(this.frameA); // keep only the last two
    this.frameA = this.frameB;
    this.frameB = frame;
  }

  private recycle(frame: Frame): void {
    const buffer = frame.data.buffer as ArrayBuffer;
    this.post({ kind: "returnBuffer", buffer }, [buffer]);
  }

  // ---- clock -------------------------------------------------------------

  /** Current sim time in epoch ms, from the same params the worker uses. */
  getSimNow(nowPerfMs: number = performance.now()): number {
    const { clockEpochMs, clockSetAt, warp } = this.clock;
    return clockEpochMs + (nowPerfMs - clockSetAt) * warp;
  }

  getClockParams(): ClockParams {
    return { ...this.clock };
  }

  /** Base the sim clock at `epochMs` running at `warp`. */
  setClock(epochMs: number, warp: number): void {
    this.clock = { clockEpochMs: epochMs, clockSetAt: performance.now(), warp };
    this.post({ kind: "clock", epochMs, warp });
    this.callbacks.onClock?.(this.getClockParams());
  }

  /** Change warp, rebasing on the current sim time so it stays continuous. */
  setWarp(warp: number): void {
    this.setClock(this.getSimNow(), warp);
  }

  /** Snap the sim clock back to real wall-clock time (keeps current warp). */
  resetToNow(): void {
    this.setClock(Date.now(), this.clock.warp);
  }

  // ---- render-side interpolation (contract §5) ---------------------------

  /**
   * Interpolated vehicle records for render time `nowPerfMs`. Matches
   * vehicles across the two newest frames by run_idx, lerps x/y/z (and the
   * remaining scalar lanes), shortest-arc lerps yaw. Renders one sim tick
   * behind the newest frame so the render time sits inside [A, B].
   * The returned Float32Array is reused between calls — consume immediately.
   */
  getInterpolated(nowPerfMs: number = performance.now()): { vehicles: Float32Array; count: number } {
    const a = this.frameA;
    const b = this.frameB;
    const out = this.outVehicles;

    if (!b) return { vehicles: out, count: 0 };
    if (!a || b.simEpochMs <= a.simEpochMs) {
      out.set(b.data.subarray(0, b.count * VEHICLE_STRIDE));
      return { vehicles: out, count: b.count };
    }

    // One 10 Hz tick of interpolation delay (in sim ms — scales with warp).
    const renderSimTime = this.getSimNow(nowPerfMs) - 100 * this.clock.warp;
    const span = b.simEpochMs - a.simEpochMs;
    const alpha = Math.min(Math.max((renderSimTime - a.simEpochMs) / span, 0), 1.25);

    let n = 0;
    // Vehicles in the newer frame: interpolate when also present in A.
    for (let i = 0; i < b.count && n < MAX_VEHICLES; i++) {
      const ob = i * VEHICLE_STRIDE;
      const oa = a.byRun.get(b.data[ob + LANE_RUN_IDX]);
      const oo = n * VEHICLE_STRIDE;
      if (oa === undefined) {
        for (let k = 0; k < VEHICLE_STRIDE; k++) out[oo + k] = b.data[ob + k];
      } else {
        for (let k = 0; k < VEHICLE_STRIDE; k++) {
          out[oo + k] =
            k === LANE_YAW
              ? a.data[oa + k] + angleDelta(a.data[oa + k], b.data[ob + k]) * alpha
              : a.data[oa + k] + (b.data[ob + k] - a.data[oa + k]) * alpha;
        }
      }
      n++;
    }
    // Vehicles only in the older frame render at that frame's pose.
    for (let i = 0; i < a.count && n < MAX_VEHICLES; i++) {
      const oa = i * VEHICLE_STRIDE;
      if (b.byRun.has(a.data[oa + LANE_RUN_IDX])) continue;
      out.set(a.data.subarray(oa, oa + VEHICLE_STRIDE), n * VEHICLE_STRIDE);
      n++;
    }
    return { vehicles: out, count: n };
  }

  dispose(): void {
    this.disposed = true;
    this.post({ kind: "stop" });
    this.worker.terminate();
    this.frameA = null;
    this.frameB = null;
  }
}
