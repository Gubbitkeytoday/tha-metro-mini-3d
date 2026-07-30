import { create } from "zustand";

/**
 * UI-facing state only (SRS §3A.7): per-frame render/kinematic state must
 * never live here — Zustand state changes trigger React re-renders.
 */
interface AppState {
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mapReady: false,
  setMapReady: (ready) => set({ mapReady: ready }),
}));
