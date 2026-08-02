import { useEffect, useState } from "react";
import { activeSimClient } from "../sim/SimClient";
import { useAppStore, type Warp } from "../stores/useAppStore";
import { useStrings } from "../i18n/useStrings";
import { GLASS } from "./glass";

/**
 * Bottom-center overlay: Bangkok sim clock, warp controls, vehicle count and
 * the validation summary line (the visible MVP 2 DoD artifact). Reads only
 * slow-changing UI state from Zustand; the clock text ticks on a local
 * interval so nothing re-renders per animation frame (ENGINE_CONTRACT.md §6).
 */

const WARPS: Warp[] = [1, 5, 10, 60];

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function TimeControls() {
  const t = useStrings();
  const engineStatus = useAppStore((s) => s.engineStatus);
  const engineError = useAppStore((s) => s.engineError);
  const validation = useAppStore((s) => s.validation);
  const warp = useAppStore((s) => s.warp);
  const vehicleCount = useAppStore((s) => s.vehicleCount);
  const [clockText, setClockText] = useState("--:--:--");

  useEffect(() => {
    if (engineStatus !== "ready") return;
    const tick = () => {
      const { clockEpochMs, clockSetAt, warp: w } = useAppStore.getState();
      // React bails out when the formatted string is unchanged.
      setClockText(clockFormat.format(clockEpochMs + (performance.now() - clockSetAt) * w));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [engineStatus]);

  if (engineStatus === "off") return null;

  return (
    <div
      className={`pointer-events-auto w-[min(32rem,calc(100vw-1rem))] rounded-xl px-3 py-2 sm:w-auto sm:px-4 sm:py-3 ${GLASS}`}
    >
      {engineStatus === "error" ? (
        <p className="max-w-xs text-xs text-red-600">
          {t.engineError}: {engineError ?? "—"}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-1.5 sm:gap-2">
          {/* Phone: clock and warp share one row so the bar stays one line
              tall and the map keeps the screen. Tablet and up: stacked, as
              before, with room for the full status line. */}
          <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:w-auto">
            <span className="font-mono text-base font-semibold tabular-nums text-slate-900 sm:text-lg">
              {engineStatus === "ready" ? clockText : "--:--:--"}
            </span>
            <span className="text-xs text-slate-500">
              {t.bangkok}
            </span>
            {engineStatus === "ready" && (
              <span className="text-xs text-slate-700">
                {vehicleCount} {vehicleCount === 1 ? t.train : t.trains}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1" data-tour="warp">
            {WARPS.map((w) => (
              <button
                key={w}
                type="button"
                disabled={engineStatus !== "ready"}
                onClick={() => activeSimClient.current?.setWarp(w)}
                // Comfortable on any coarse pointer (phone AND tablet),
                // compact for a mouse.
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
                  w === warp
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200/70 text-slate-700 hover:bg-slate-300"
                }`}
              >
                {w}×
              </button>
            ))}
            <button
              type="button"
              disabled={engineStatus !== "ready"}
              onClick={() => activeSimClient.current?.resetToNow()}
              className="ml-2 rounded-md bg-slate-200/70 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              {t.now}
            </button>
          </div>
          {/* The feed provenance line is the MVP 2 DoD artifact and stays on
              anything tablet-sized or larger; on a phone it wraps to three
              lines and pushes the map off screen, so it is dropped there
              rather than shrunk into illegibility. A landscape phone is wide
              enough for it but only ~390 px tall, where the bottom stack
              would eat 40% of the view — hence the height query too. */}
          {validation && (
            <p className="hidden text-[10px] text-slate-500 sm:block [@media(max-height:520px)]:sm:hidden">
              feed {validation.feedVersion} · {validation.routes} routes ·{" "}
              {validation.stations} stations · {validation.patterns} patterns ·{" "}
              {validation.runs} runs · {validation.services} services
            </p>
          )}
        </div>
      )}
    </div>
  );
}
