import { useEffect, useMemo, useState } from "react";
import type { RunDetail, StationInfo } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { buildNameIndex, lineName, localiseEngineName } from "../i18n/languages";
import { useLanguage, useStrings } from "../i18n/useStrings";
import { GLASS_DIVIDER } from "./glass";
import { OverlayPanel } from "./OverlayPanel";

/** `${route_idx}:${station_idx}` — the natural key for cross-route station lookup. */
function stationKey(routeIdx: number, stationIdx: number): string {
  return `${routeIdx}:${stationIdx}`;
}

/**
 * Train inspector card (F4.2) — route, headsign, origin/destination, next-stop
 * ETA and the full scheduled call list for the selected run.
 *
 * Detail is pulled from the engine at 1 Hz, NOT per frame: the pose comes from
 * the vehicle buffer, but everything readable here is cache-derived and only
 * changes when the train reaches a stop (§3A.2, §3A.7).
 */

/** How often to refresh detail while a train is selected. */
const POLL_MS = 1000;

export function TrainInspector() {
  const t = useStrings();
  const language = useLanguage();
  const selectedRunIdx = useAppStore((s) => s.selectedRunIdx);
  const following = useAppStore((s) => s.following);
  const selectRun = useAppStore((s) => s.selectRun);
  const setFollowing = useAppStore((s) => s.setFollowing);
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [ended, setEnded] = useState(false);

  // The schedule list is up to ~47 stops for a full-line run; a plain
  // stations.find() per stop was an O(stops * stations) scan every render.
  const stationByKey = useMemo(() => {
    const map = new Map<string, StationInfo>();
    for (const s of stations) map.set(stationKey(s.route_idx, s.station_idx), s);
    return map;
  }, [stations]);

  const nameIndex = useMemo(() => buildNameIndex(routes), [routes]);
  /** Engine names arrive in English; show them in the chosen language.
   *  Accepts null because `at_station`/`prev_station` are null off-route. */
  const local = (name: string | null) =>
    name === null ? "" : localiseEngineName(nameIndex, { name_en: name, name_th: "" }, language);

  useEffect(() => {
    if (selectedRunIdx === null) {
      setDetail(null);
      setEnded(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const d = await client.getRunDetail(selectedRunIdx, client.getSimNow());
        if (cancelled) return;
        setDetail(d);
        // null = the run is no longer live (finished, or the clock moved off
        // its service window) — exactly when it leaves the vehicle buffer.
        setEnded(d === null);
      } catch {
        // Worker torn down mid-flight; the next selection re-queries.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedRunIdx]);

  if (selectedRunIdx === null) return null;

  const color = detail ? `#${detail.color_rgb.toString(16).padStart(6, "0")}` : "#94a3b8";

  return (
    <OverlayPanel
      title={detail ? local(detail.headsign) : t.train}
      subtitle={detail ? `${detail.route_name} · run ${detail.run_idx}` : `run ${selectedRunIdx}`}
      accent={color}
      onClose={() => selectRun(null)}
      closeLabel={t.closeInspector}
    >
      {ended ? (
        <p className="px-4 py-3 text-xs text-slate-500">
          {t.runFinished}
        </p>
      ) : !detail ? (
        <p className="px-4 py-3 text-xs text-slate-500">{t.loading}</p>
      ) : (
        <>
          <div className="space-y-2 px-4 py-3">
            <p className="text-xs text-slate-600">
              {local(detail.origin)} → {local(detail.destination)}
            </p>
            <div className="rounded-lg bg-slate-100 px-3 py-2">
              {detail.state === 0 ? (
                <p className="text-xs text-slate-700">
                  {t.dwellingAt}{" "}
                  <span className="font-semibold text-slate-900">{local(detail.at_station)}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-700">
                  {t.departed}{" "}
                  <span className="font-medium text-slate-900">{local(detail.prev_station)}</span>
                </p>
              )}
              {detail.next_station !== null && detail.next_arrival_in_s !== null ? (
                <p className="mt-1 text-xs text-slate-700">
                  {t.next}: <span className="font-semibold text-slate-900">{local(detail.next_station)}</span>{" "}
                  in{" "}
                  <span className="font-mono tabular-nums">
                    {formatCountdown(detail.next_arrival_in_s)}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">{t.terminus}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFollowing(!following)}
              className={`w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${
                following
                  ? "bg-slate-900 text-white hover:bg-slate-700"
                  : "bg-slate-200/80 text-slate-700 hover:bg-slate-300"
              }`}
            >
              {following ? t.following : t.followThisTrain}
            </button>
          </div>

          <div className={`min-h-0 flex-1 overflow-y-auto border-t px-4 py-2 ${GLASS_DIVIDER}`}>
            <p className="pb-1 text-[10px] uppercase tracking-wide text-slate-400">{t.schedule}</p>
            <ol className="space-y-0.5">
              {detail.stops.map((stop, i) => {
                const isNext = detail.next_stop_ordinal === i;
                // The stop being dwelt at is neither "next" nor "passed" — the
                // engine names it outright so this doesn't grey out the very
                // station the panel above says the train is sitting at.
                const isCurrent = detail.current_stop_ordinal === i;
                const passed =
                  !isCurrent &&
                  (detail.next_stop_ordinal === null || i < detail.next_stop_ordinal);
                const stationInfo = stationByKey.get(stationKey(detail.route_idx, stop.station_idx));
                return (
                  <li
                    key={`${stop.station_idx}-${i}`}
                    className={`flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-xs ${
                      isNext
                        ? "bg-slate-900 text-white"
                        : isCurrent
                          ? "bg-slate-200 font-medium text-slate-900"
                          : passed
                            ? "text-slate-400"
                            : "text-slate-700"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {stop.code ? `${stop.code} · ` : ""}
                      {local(stop.name_en)}
                      {stationInfo && stationInfo.interchanges.length > 0 && (
                        <span className="ml-1 inline-flex flex-wrap items-center gap-1">
                          {stationInfo.interchanges.map((ix) => (
                            <span
                              key={`${ix.route_idx}-${ix.station_idx}`}
                              className="rounded-full px-1 py-0 text-[9px] font-medium text-white"
                              style={{ background: routes[ix.route_idx]?.color ?? "#64748b" }}
                            >
                              {routes[ix.route_idx] ? lineName(routes[ix.route_idx], language) : `Route ${ix.route_idx}`}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatServiceSec(stop.arrival_sec)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </OverlayPanel>
  );
}
