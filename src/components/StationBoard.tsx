import { useEffect, useMemo, useState } from "react";
import type { StationBoard as StationBoardData, StationInfo } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { buildNameIndex, lineName, localiseEngineName } from "../i18n/languages";
import { useLanguage, useStrings } from "../i18n/useStrings";
import { OverlayPanel } from "./OverlayPanel";

/** `${route_idx}:${station_idx}` — the natural key for cross-route station lookup. */
function stationKey(routeIdx: number, stationIdx: number): string {
  return `${routeIdx}:${stationIdx}`;
}

/**
 * Live timetable drawer for the selected station (F4.3): the next scheduled
 * calls, soonest first, straight from the engine's own schedule so it can
 * never drift from the trains on screen.
 *
 * Polled at 1 Hz — cache-derived data, never on the frame path (§3A.7).
 * Clicking a row selects that train, handing off to the inspector.
 */

const POLL_MS = 1000;
const LIMIT = 10;

export function StationBoard() {
  const t = useStrings();
  const language = useLanguage();
  const selectedStation = useAppStore((s) => s.selectedStation);
  const selectStation = useAppStore((s) => s.selectStation);
  const selectRun = useAppStore((s) => s.selectRun);
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const [board, setBoard] = useState<StationBoardData | null>(null);

  const routeIdx = selectedStation?.routeIdx;
  const stationIdx = selectedStation?.stationIdx;

  useEffect(() => {
    if (routeIdx === undefined || stationIdx === undefined) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const b = await client.getStationBoard(
          routeIdx,
          stationIdx,
          client.getSimNow(),
          LIMIT,
        );
        if (!cancelled) setBoard(b);
      } catch {
        // Worker torn down mid-flight; re-queried on the next selection.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [routeIdx, stationIdx]);

  const stationByKey = useMemo(() => {
    const map = new Map<string, StationInfo>();
    for (const s of stations) map.set(stationKey(s.route_idx, s.station_idx), s);
    return map;
  }, [stations]);

  const nameIndex = useMemo(() => buildNameIndex(routes), [routes]);

  if (!selectedStation) return null;

  const info = stationByKey.get(stationKey(selectedStation.routeIdx, selectedStation.stationIdx));

  return (
    <OverlayPanel
      title={
        board
          ? `${board.code ? `${board.code} · ` : ""}${localiseEngineName(nameIndex, board, language)}`
          : t.station
      }
      // No subtitle: the panel shows the station's name in the CHOSEN language
      // only. It used to pair English with Thai, which is how the platform
      // signs read but is not what "pick a language" means.
      onClose={() => selectStation(null)}
      closeLabel={t.closeStationBoard}
    >
      {info && info.interchanges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-4 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">{t.interchange}</span>
          {info.interchanges.map((ix) => (
            <span
              key={`${ix.route_idx}-${ix.station_idx}`}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: routes[ix.route_idx]?.color ?? "#64748b" }}
            >
              {routes[ix.route_idx] ? lineName(routes[ix.route_idx], language) : `Route ${ix.route_idx}`}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
          {t.nextDepartures}
        </p>
        {!board ? (
          <p className="px-2 py-2 text-xs text-slate-500">{t.loading}</p>
        ) : board.entries.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">
            {t.noMoreServices}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {board.entries.map((e) => (
              <li key={`${e.run_idx}-${e.arrival_sec}`}>
                <button
                  type="button"
                  onClick={() => selectRun(e.run_idx)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-200 pointer-coarse:min-h-11"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-900">{e.destination}</span>
                    <span className="ml-1 text-slate-400">
                      {formatServiceSec(e.departure_sec)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono tabular-nums ${
                      e.in_s <= 0 ? "font-semibold text-slate-900" : ""
                    }`}
                  >
                    {formatCountdown(e.in_s)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </OverlayPanel>
  );
}
