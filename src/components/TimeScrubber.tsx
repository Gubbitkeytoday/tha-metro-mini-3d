import { useEffect, useState } from "react";
import { activeSimClient } from "../sim/SimClient";
import { bangkokDayStartMs, bangkokSecOfDay, DAY_SEC, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { useStrings } from "../i18n/useStrings";
import { GLASS } from "./glass";

/**
 * Time scrubber (F2.3): drag to any moment of the current Bangkok service day
 * and the whole network jumps to where it should be then.
 *
 * Scrubbing rebases the sim clock through SimClient.setClock, which is the
 * same path the warp buttons use — the worker re-evaluates from scratch, so
 * positions are a pure function of the new time with no state to unwind.
 *
 * While dragging, the slider is driven by local state; the rest of the time it
 * follows the sim clock on a 1 Hz tick (never per frame).
 */

/** One minute per slider step — finer than anyone can aim at this width. */
const STEP_SEC = 60;
const TICK_MS = 1000;

export function TimeScrubber() {
  const t = useStrings();
  const engineStatus = useAppStore((s) => s.engineStatus);
  const [sec, setSec] = useState(() => bangkokSecOfDay(Date.now()));
  const [dragging, setDragging] = useState(false);

  // Belt and braces: a pointerup delivered to another element (released off
  // the slider, or some touch paths) would never clear `dragging`, wedging the
  // resync effect below and silently stopping the scrubber from tracking.
  useEffect(() => {
    if (!dragging) return;
    const release = () => setDragging(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [dragging]);

  useEffect(() => {
    if (engineStatus !== "ready" || dragging) return;
    const tick = () => {
      const client = activeSimClient.current;
      if (client) setSec(bangkokSecOfDay(client.getSimNow()));
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [engineStatus, dragging]);

  if (engineStatus !== "ready") return null;

  /** Move the sim clock to `nextSec` on the day currently being shown. */
  const scrubTo = (nextSec: number) => {
    const client = activeSimClient.current;
    if (!client) return;
    const dayStart = bangkokDayStartMs(client.getSimNow());
    client.setClock(dayStart + nextSec * 1000, client.getClockParams().warp);
  };

  return (
    <div
      className={`pointer-events-auto w-[min(32rem,calc(100vw-1rem))] rounded-xl px-3 py-2.5 sm:px-4 ${GLASS}`}
    >
      <div className="flex items-center gap-3" data-tour="scrub">
        {/* The label is pure decoration next to a slider that is obviously a
            slider — on a phone those 34px buy visible track instead. */}
        <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-slate-400 sm:inline">
          {t.scrub}
        </span>
        <input
          type="range"
          min={0}
          max={DAY_SEC - STEP_SEC}
          step={STEP_SEC}
          value={Math.min(sec, DAY_SEC - STEP_SEC)}
          aria-label={t.scrub}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onChange={(e) => {
            const next = Number(e.target.value);
            setSec(next);
            scrubTo(next);
          }}
          // Track/thumb styling lives in index.css so the thumb can grow to a
          // real touch target under `@media (pointer: coarse)`; py-2 widens
          // the grab area vertically without changing the visual track height.
          className="w-full cursor-pointer py-2"
        />
        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-slate-700">
          {formatServiceSec(sec)}
        </span>
      </div>
    </div>
  );
}
