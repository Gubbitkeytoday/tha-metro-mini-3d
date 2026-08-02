import { useIsCompact, useIsShort } from "../hooks/useMediaQuery";
import { useAppStore } from "../stores/useAppStore";
import { lineName } from "../i18n/languages";
import { useLanguage, useStrings } from "../i18n/useStrings";
import { GLASS } from "./glass";
import { SceneModes } from "./SceneModes";
import type { LineGeometry } from "../types";

/** One toggleable row — its own component so it can call the store's
 * `isRouteVisible` selector directly (the canonical, tested "is this route
 * hidden" check) instead of `LineSelector` re-deriving it with a raw
 * `hiddenRoutes.includes()` per row, which a hook can't do from inside a
 * `.map()` callback. */
function LineRow({ line, routeIdx }: { line: LineGeometry; routeIdx: number }) {
  const t = useStrings();
  const language = useLanguage();
  const visible = useAppStore((s) => s.isRouteVisible(routeIdx));
  const toggleRoute = useAppStore((s) => s.toggleRoute);
  return (
    <li>
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => toggleRoute(routeIdx)}
        // Sized by POINTER TYPE, not viewport width. Keying this off `sm:`
        // was wrong and the responsive harness caught it: an iPad is 768 px
        // wide but every target on it is a fingertip, so it was getting the
        // 24 px mouse-sized rows. `pointer-coarse` asks the real question.
        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-200/60 pointer-coarse:min-h-11 ${
          visible ? "text-slate-800" : "text-slate-400"
        }`}
      >
        <span
          className="inline-block h-2 w-4 shrink-0 rounded-sm"
          style={{ background: line.color, opacity: visible ? 1 : 0.3 }}
        />
        <span className="truncate">{lineName(line, language)}</span>
        {line.gtfsRouteId === null && (
          <span className="ml-auto shrink-0 text-[9px] uppercase text-slate-400">
            {t.trackOnly}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Line visibility toggles (F4.1). Doubles as the map legend — it is the only
 * place the user learns which colour is which line.
 *
 * Hiding a line hides its track, stations and trains but does NOT stop the
 * engine evaluating it: the sim is a pure function of time, and skipping runs
 * would make the vehicle count and the station boards disagree with the clock.
 *
 * **Responsive behaviour.** On a laptop or tablet the panel is simply always
 * open — there is room, and it is the legend, so hiding it costs more than it
 * saves. On a phone (and on any very short viewport, i.e. a landscape phone)
 * it collapses to its header: ten line rows plus the view toggles is over half
 * a phone screen, and the map is the point. The collapsed state is derived
 * from the viewport only as an initial value — once the user opens or closes
 * it by hand, that choice sticks across rotation rather than being overridden.
 */
export function LineSelector() {
  const t = useStrings();
  const routes = useAppStore((s) => s.routes);
  const mapReady = useAppStore((s) => s.mapReady);
  const isCompact = useIsCompact();
  const isShort = useIsShort();
  const shouldAutoCollapse = isCompact || isShort;

  /** Null until the user (or the tour) touches the control; after that that
   *  choice wins, so rotating the device doesn't reopen a panel they
   *  deliberately closed. Lives in the store so the guided tour can open the
   *  panel before spotlighting a control inside it. */
  const userChoice = useAppStore((s) => s.panelExpanded);
  const setUserChoice = useAppStore((s) => s.setPanelExpanded);
  const expanded = userChoice ?? !shouldAutoCollapse;

  return (
    // Capped at 70dvh rather than "the whole viewport minus a margin": with
    // fingertip-sized rows an expanded ten-line list is ~700 px, which filled
    // 91% of an iPad in landscape and left no map. The list scrolls inside
    // instead.
    <div
      className={`pointer-events-auto absolute left-2 top-2 z-20 flex max-h-[70dvh] w-[min(15rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl sm:left-4 sm:top-4 sm:w-60 ${GLASS}`}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-slate-900">
            {t.appTitle}
          </h1>
          <p className="text-xs text-slate-500">
            {mapReady ? t.tapHint : t.loadingMap}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t.hidePanel : t.showPanel}
          onClick={() => setUserChoice(!expanded)}
          className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {routes.length > 0 && (
            <ul className="space-y-0.5" data-tour="lines">
              {routes.map((line, routeIdx) => (
                <LineRow key={line.key} line={line} routeIdx={routeIdx} />
              ))}
            </ul>
          )}
          <SceneModes />
        </div>
      )}
    </div>
  );
}
