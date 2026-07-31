import { useAppStore } from "../stores/useAppStore";

/**
 * Line visibility toggles (F4.1). Doubles as the map legend — it is the only
 * place the user learns which colour is which line.
 *
 * Hiding a line hides its track, stations and trains but does NOT stop the
 * engine evaluating it: the sim is a pure function of time, and skipping runs
 * would make the vehicle count and the station boards disagree with the clock.
 */
export function LineSelector() {
  const routes = useAppStore((s) => s.routes);
  const hiddenRoutes = useAppStore((s) => s.hiddenRoutes);
  const toggleRoute = useAppStore((s) => s.toggleRoute);
  const mapReady = useAppStore((s) => s.mapReady);

  if (routes.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute left-4 top-4 max-h-[calc(100dvh-2rem)] w-60 overflow-y-auto rounded-xl bg-white/85 px-4 py-3 shadow-lg backdrop-blur">
      <h1 className="text-sm font-semibold text-slate-900">Greater Bangkok Metro Mini 3D</h1>
      <p className="mb-2 text-xs text-slate-500">
        Click a train or station to inspect it.{mapReady ? "" : " · loading map…"}
      </p>
      <ul className="space-y-0.5">
        {routes.map((line, routeIdx) => {
          const visible = !hiddenRoutes.includes(routeIdx);
          return (
            <li key={line.key}>
              <button
                type="button"
                aria-pressed={visible}
                onClick={() => toggleRoute(routeIdx)}
                className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-200/60 ${
                  visible ? "text-slate-800" : "text-slate-400"
                }`}
              >
                <span
                  className="inline-block h-2 w-4 shrink-0 rounded-sm"
                  style={{ background: line.color, opacity: visible ? 1 : 0.3 }}
                />
                <span className="truncate">{line.name}</span>
                {line.gtfsRouteId === null && (
                  <span className="ml-auto shrink-0 text-[9px] uppercase text-slate-400">
                    track only
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
