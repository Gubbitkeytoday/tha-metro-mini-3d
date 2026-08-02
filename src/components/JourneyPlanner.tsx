import { useEffect, useMemo, useRef, useState } from "react";
import { buildNameIndex, lineName, localiseEngineName } from "../i18n/languages";
import { useLanguage, useStrings } from "../i18n/useStrings";
import { activeMap } from "../map/activeMap";
import { localToLngLat } from "../map/coordinates";
import { NetworkGraph, type Journey, type JourneyLeg } from "../routing/graph";
import { sampleHopTimes } from "../routing/hopTimes";
import { buildSearchIndex, searchStations } from "../routing/search";
import { activeSimClient } from "../sim/SimClient";
import type { StationInfo } from "../sim/protocol";
import { useAppStore } from "../stores/useAppStore";
import { GLASS, GLASS_DIVIDER } from "./glass";

/**
 * Search and journey planning — the "I have just arrived and I do not know
 * how any of this works" feature.
 *
 * Two things in one panel because they are one task. Somebody who types a
 * place name either wants to look at it or wants to get to it, and making
 * those separate features would mean finding the same station twice.
 *
 * The answer is deliberately shaped as instructions rather than a route
 * summary: "board here, ride 4 stops, change at Asok". A newcomer standing on
 * a concourse needs to know what to do next, not the total distance.
 */

function formatDuration(seconds: number, minutesLabel: string): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} ${minutesLabel}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function JourneyPlanner() {
  const t = useStrings();
  const language = useLanguage();
  const open = useAppStore((s) => s.plannerOpen);
  const setOpen = useAppStore((s) => s.setPlannerOpen);
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const selectStation = useAppStore((s) => s.selectStation);

  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<StationInfo | null>(null);
  const [destination, setDestination] = useState<StationInfo | null>(null);
  const [picking, setPicking] = useState<"origin" | "destination">("origin");
  const [graph, setGraph] = useState<NetworkGraph | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameIndex = useMemo(() => buildNameIndex(routes), [routes]);
  const searchIndex = useMemo(
    () => (stations.length > 0 ? buildSearchIndex(stations, nameIndex) : []),
    [stations, nameIndex],
  );
  const results = useMemo(
    () => searchStations(searchIndex, query),
    [searchIndex, query],
  );

  const label = (station: StationInfo) => localiseEngineName(nameIndex, station, language);

  /**
   * Build the graph once the panel is first opened, not at start-up: it needs
   * a round trip to the engine per route for real hop times, and most visitors
   * never open the planner at all.
   */
  useEffect(() => {
    if (!open || graph || stations.length === 0) return;
    const client = activeSimClient.current;
    if (!client) return;
    let cancelled = false;
    void (async () => {
      const hops = await sampleHopTimes(
        client,
        stations,
        routes.map((r) => r.vehicleType),
      );
      if (!cancelled) setGraph(new NetworkGraph(stations, hops));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, graph, stations, routes]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const journey: Journey | null = useMemo(() => {
    if (!graph || !origin || !destination) return null;
    return graph.plan(origin, destination);
  }, [graph, origin, destination]);

  const flyTo = (station: StationInfo) => {
    const { lng, lat } = localToLngLat(station.x, station.y);
    activeMap.current?.easeTo({
      center: [lng, lat],
      zoom: 15.2,
      pitch: 60,
      duration: 1_400,
      essential: true,
    });
  };

  const choose = (station: StationInfo) => {
    if (picking === "origin") {
      setOrigin(station);
      setPicking("destination");
    } else {
      setDestination(station);
    }
    setQuery("");
    flyTo(station);
  };

  const showStation = (station: StationInfo) => {
    selectStation({ routeIdx: station.route_idx, stationIdx: station.station_idx });
    flyTo(station);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={t.planTrip}
      // The station board is also a labelled dialog, so a bare
      // `[role=dialog]` lookup can land on the wrong panel.
      data-panel="planner"
      className={[
        "pointer-events-auto z-40 flex max-h-[80dvh] flex-col overflow-hidden",
        "fixed inset-x-2 top-2 rounded-2xl",
        "sm:inset-x-auto sm:left-1/2 sm:top-6 sm:w-[28rem] sm:-translate-x-1/2 sm:rounded-xl",
        GLASS,
      ].join(" ")}
    >
      <div className={`flex items-start gap-2 border-b px-4 py-3 ${GLASS_DIVIDER}`}>
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{t.planTrip}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t.close}
          className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-lg"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* From / To. Tapping either one aims the search box at it, so the
            whole flow is: tap a field, type, pick. */}
        <div className="mb-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-slate-400">{t.from}</span>
          <button
            type="button"
            onClick={() => setPicking("origin")}
            className={`truncate rounded-md px-2 py-1.5 text-left transition-colors pointer-coarse:min-h-11 ${
              picking === "origin" ? "bg-slate-900 text-white" : "bg-slate-200/70 text-slate-700"
            }`}
          >
            {origin ? label(origin) : t.chooseStation}
          </button>
          <span className="text-slate-400">{t.to}</span>
          <button
            type="button"
            onClick={() => setPicking("destination")}
            className={`truncate rounded-md px-2 py-1.5 text-left transition-colors pointer-coarse:min-h-11 ${
              picking === "destination"
                ? "bg-slate-900 text-white"
                : "bg-slate-200/70 text-slate-700"
            }`}
          >
            {destination ? label(destination) : t.chooseStation}
          </button>
        </div>

        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className="w-full rounded-md border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 pointer-coarse:min-h-11"
        />

        {query.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {results.length === 0 && (
              <li className="px-2 py-2 text-xs text-slate-500">{t.noStationFound}</li>
            )}
            {results.map((result) => {
              const station = result.entry.station;
              return (
                <li key={`${station.route_idx}:${station.station_idx}`} className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => choose(station)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-slate-200/70 pointer-coarse:min-h-11"
                  >
                    <span
                      className="inline-block h-2 w-4 shrink-0 rounded-sm"
                      style={{ background: routes[station.route_idx]?.color ?? "#64748b" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      {station.code ? `${station.code} · ` : ""}
                      {label(station)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => showStation(station)}
                    title={t.showOnMap}
                    aria-label={t.showOnMap}
                    className="shrink-0 rounded-md bg-slate-200/70 px-2 text-xs text-slate-700 hover:bg-slate-300 pointer-coarse:min-h-11"
                  >
                    ◎
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {origin && destination && (
          <div className={`mt-3 border-t pt-3 ${GLASS_DIVIDER}`}>
            {!graph ? (
              <p className="text-xs text-slate-500">{t.loading}</p>
            ) : !journey ? (
              <p className="text-xs text-slate-600">{t.noRouteFound}</p>
            ) : journey.legs.length === 0 ? (
              <p className="text-xs text-slate-600">{t.sameStation}</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium text-slate-800">
                  {formatDuration(journey.totalSeconds, t.minutes)} ·{" "}
                  {journey.transfers === 0
                    ? t.noChanges
                    : journey.transfers === 1
                      ? t.oneChange
                      : t.someChanges.replace("{n}", String(journey.transfers))}
                </p>
                <ol className="space-y-2">
                  {journey.legs.map((leg, i) => (
                    <Leg
                      key={i}
                      leg={leg}
                      label={label}
                      routeColor={routes[leg.routeIdx]?.color ?? "#64748b"}
                      routeLabel={
                        routes[leg.routeIdx] ? lineName(routes[leg.routeIdx], language) : ""
                      }
                      onFocus={() => flyTo(leg.from)}
                    />
                  ))}
                </ol>
              </>
            )}
          </div>
        )}

        {!origin && !destination && query.length === 0 && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">{t.plannerHint}</p>
        )}
      </div>
    </div>
  );
}

function Leg({
  leg,
  label,
  routeColor,
  routeLabel,
  onFocus,
}: {
  leg: JourneyLeg;
  label: (s: StationInfo) => string;
  routeColor: string;
  routeLabel: string;
  onFocus: () => void;
}) {
  const t = useStrings();
  const stopCount = leg.stops.length + 1;
  return (
    <li>
      <button
        type="button"
        onClick={onFocus}
        className="flex w-full gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-slate-200/60"
      >
        <span
          className="mt-1 h-full w-1 shrink-0 rounded-full"
          style={{ background: leg.kind === "transfer" ? "#94a3b8" : routeColor, minHeight: "2rem" }}
        />
        <span className="min-w-0 flex-1 text-xs">
          {leg.kind === "transfer" ? (
            <>
              <span className="font-medium text-slate-900">{t.changeHere}</span>
              <span className="block text-slate-600">{label(leg.to)}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-900">{routeLabel}</span>
              <span className="block text-slate-600">
                {t.boardAt.replace("{station}", label(leg.from))}
              </span>
              <span className="block text-slate-600">
                {t.rideStops.replace("{n}", String(stopCount))} ·{" "}
                {t.alightAt.replace("{station}", label(leg.to))}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

/** The search button, sitting where a newcomer will look for it. */
export function PlannerButton() {
  const t = useStrings();
  const setOpen = useAppStore((s) => s.setPlannerOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t.planTrip}
      data-tour="planner"
      className={`pointer-events-auto absolute right-2 top-40 z-20 flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:text-slate-900 sm:right-4 sm:top-44 pointer-coarse:h-11 pointer-coarse:w-11 ${GLASS}`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5 L17.5 17.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
