import { create } from "zustand";
import type { ValidationSummary } from "../sim/protocol";
import type { ClockParams } from "../sim/SimClient";

/**
 * UI-facing state only (SRS §3A.7): per-frame render/kinematic state must
 * never live here — Zustand state changes trigger React re-renders. Vehicle
 * buffers stay inside SimClient/VehicleManager; only slow-changing engine
 * status, clock params (rebased on warp change) and a 1 Hz-throttled vehicle
 * count pass through the store (ENGINE_CONTRACT.md §6).
 */

export type EngineStatus = "off" | "loading" | "ready" | "error";
export type Warp = 1 | 5 | 10 | 60;

interface AppState {
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;

  engineStatus: EngineStatus;
  engineError: string | null;
  setEngineStatus: (status: EngineStatus, error?: string) => void;

  validation: ValidationSummary | null;
  setValidation: (validation: ValidationSummary | null) => void;

  /** Sim clock params — simNow = clockEpochMs + (perfNow - clockSetAt) * warp. */
  warp: Warp;
  clockEpochMs: number;
  clockSetAt: number;
  setClock: (params: ClockParams) => void;

  /** Throttled to 1 Hz by MapContainer — never per-frame. */
  vehicleCount: number;
  setVehicleCount: (count: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mapReady: false,
  setMapReady: (ready) => set({ mapReady: ready }),

  engineStatus: "off",
  engineError: null,
  setEngineStatus: (status, error) => set({ engineStatus: status, engineError: error ?? null }),

  validation: null,
  setValidation: (validation) => set({ validation }),

  warp: 1,
  clockEpochMs: Date.now(),
  clockSetAt: 0,
  setClock: ({ clockEpochMs, clockSetAt, warp }) =>
    set({ clockEpochMs, clockSetAt, warp: warp as Warp }),

  vehicleCount: 0,
  setVehicleCount: (count) => set({ vehicleCount: count }),
}));
