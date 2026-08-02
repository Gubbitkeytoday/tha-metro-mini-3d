import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useStrings } from "../i18n/useStrings";
import { loadPreferences, savePreferences } from "../lib/preferences";
import { activeMap } from "../map/activeMap";
import { localToLngLat } from "../map/coordinates";
import { activeSimClient } from "../sim/SimClient";
import { useAppStore } from "../stores/useAppStore";
import { GLASS } from "./glass";

/**
 * First-run guided tour: dim the page, cut a hole over the one control being
 * described, point an arrow at it, and explain it.
 *
 * ## How the spotlight works
 *
 * The scrim is a single absolutely-positioned box the size of the target's
 * rectangle carrying an enormous `box-shadow` spread. The shadow paints
 * everything *outside* that box dark while the box itself stays transparent —
 * one element, no SVG mask, no four-rectangle jigsaw to keep in sync, and it
 * animates smoothly from one target to the next because only the box's
 * position and size change.
 *
 * ## Why the target is found by selector, per step
 *
 * Steps point at real controls (`[data-tour="lighting"]`, …), not at
 * screenshots or coordinates, so the highlight cannot drift out of alignment
 * when the layout changes. It also means a step whose control is not on screen
 * has an honest fallback: no hole, centred card, no arrow pointing at nothing.
 *
 * Rects are measured in a layout effect and re-measured on resize, orientation
 * change and step change — a phone rotating mid-tour must not leave the
 * spotlight behind.
 *
 * ## Two things it deliberately does NOT do
 *
 * - It does not block the map from animating. Trains keep running behind the
 *   scrim, because several steps are about watching them.
 * - It does not leave the app changed. Steps that demonstrate a mode (night,
 *   see-through tunnels) revert it in `finish()`.
 */

interface TourStep {
  title: string;
  body: string;
  /** `[data-tour]` value of the element to spotlight; omitted = centred card. */
  target?: string;
  /** Opens the left panel first, so a control inside it exists to point at. */
  needsPanel?: boolean;
  /** Applied on entering the step; reverted by `finish()`. */
  apply?: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Fly the camera to a live train, select it, and let the inspector open.
 *
 * A step that says "tap a train" and then leaves you looking at a city-wide
 * view has taught nothing — at that zoom a train is two pixels. This does what
 * the step describes: finds a vehicle that is actually running right now,
 * moves the camera onto it and selects it, so the panel the sentence promises
 * appears while the sentence is on screen.
 *
 * Returns false when the sim has no live vehicle (before the engine is ready,
 * or at 03:00 with the network shut), so the caller can fall back to a plain
 * card instead of pointing at a panel that will never arrive.
 */
function showcaseTrain(): boolean {
  const map = activeMap.current;
  const client = activeSimClient.current;
  if (!map || !client) return false;

  const { vehicles, count } = client.getInterpolated(performance.now());
  if (count === 0) return false;

  // Prefer one that is moving: a dwelling train sitting in a station is a
  // poor advertisement for "watch the trains run".
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (vehicles[i * 8 + 4] === 1) {
      offset = i * 8;
      break;
    }
  }

  const { lng, lat } = localToLngLat(vehicles[offset], vehicles[offset + 1]);
  useAppStore.getState().selectRun(vehicles[offset + 5]);
  map.easeTo({
    center: [lng, lat],
    zoom: 15.4,
    pitch: 62,
    duration: 2_200,
    essential: true,
  });
  return true;
}

/** Swing the camera so the viewer sees what "orbit" actually does. */
function demonstrateOrbit(): void {
  const map = activeMap.current;
  if (!map) return;
  map.easeTo({
    bearing: map.getBearing() + 75,
    pitch: Math.min(map.getMaxPitch(), 72),
    duration: 4_000,
    essential: true,
  });
}

/** Pull back to the whole region — the view the intro and outro describe. */
function showWholeNetwork(): void {
  activeMap.current?.easeTo({
    center: [100.55, 13.78],
    zoom: 10.6,
    pitch: 58,
    bearing: -14,
    duration: 2_000,
    essential: true,
  });
}

/** Drop onto the Blue Line's tunnelled core, where the underground shows. */
function showUndergroundCore(): void {
  activeMap.current?.easeTo({
    center: [100.5285, 13.7385],
    zoom: 14.2,
    pitch: 66,
    bearing: 20,
    duration: 2_200,
    essential: true,
  });
}

/** Breathing room between the cut-out and the highlighted control, in px. */
const HALO = 8;
/** Gap between the highlighted control and the tour card. */
const CARD_GAP = 16;
const CARD_WIDTH = 340;

export function Tour() {
  const t = useStrings();
  const mapReady = useAppStore((s) => s.mapReady);
  const tourOpen = useAppStore((s) => s.tourOpen);
  const setTourOpen = useAppStore((s) => s.setTourOpen);
  const setLightingMode = useAppStore((s) => s.setLightingMode);
  const setUndergroundVisible = useAppStore((s) => s.setUndergroundVisible);
  const setShowStationLabels = useAppStore((s) => s.setShowStationLabels);
  const setPanelExpanded = useAppStore((s) => s.setPanelExpanded);

  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!mapReady) return;
    if (loadPreferences().tourSeen) return;
    setTourOpen(true);
  }, [mapReady, setTourOpen]);

  const steps: TourStep[] = [
    { title: t.tourWelcomeTitle, body: t.tourWelcomeBody, apply: showWholeNetwork },
    {
      title: t.tourLinesTitle,
      body: t.tourLinesBody,
      target: "lines",
      needsPanel: true,
    },
    {
      title: t.tourLabelsTitle,
      body: t.tourLabelsBody,
      target: "view",
      needsPanel: true,
      apply: () => setShowStationLabels(true),
    },
    {
      title: t.tourUndergroundTitle,
      body: t.tourUndergroundBody,
      target: "view",
      needsPanel: true,
      apply: () => {
        setUndergroundVisible(true);
        // Drop onto the tunnelled core, or the sentence describes something
        // that is nowhere near the current view.
        showUndergroundCore();
      },
    },
    {
      title: t.tourLightingTitle,
      body: t.tourLightingBody,
      target: "lighting",
      needsPanel: true,
      apply: () => setLightingMode("night"),
    },
    {
      title: t.tourLanguageTitle,
      body: t.tourLanguageBody,
      target: "language",
      needsPanel: true,
    },
    {
      title: t.tourLocationTitle,
      body: t.tourLocationBody,
      target: "location",
      needsPanel: true,
    },
    { title: t.tourTimeTitle, body: t.tourTimeBody, target: "scrub" },
    { title: t.tourWarpTitle, body: t.tourWarpBody, target: "warp" },
    {
      title: t.tourTrainsTitle,
      body: t.tourTrainsBody,
      // Zooms to a live train and selects it, so the inspector this step is
      // describing is on screen — and is what gets highlighted.
      target: "detail",
      apply: () => {
        showcaseTrain();
      },
    },
    {
      title: t.tourCameraTitle,
      body: t.tourCameraBody,
      // Actually orbits, rather than describing an orbit.
      apply: demonstrateOrbit,
    },
    {
      title: t.tourPlannerTitle,
      body: t.tourPlannerBody,
      target: "planner",
    },
    { title: t.tourHelpTitle, body: t.tourHelpBody, target: "about" },
    { title: t.tourDoneTitle, body: t.tourDoneBody, apply: showWholeNetwork },
  ];

  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;

  const finish = useCallback(() => {
    // Put back everything the tour switched on to demonstrate it. The camera
    // is deliberately left where it is — the last step pulls out to the whole
    // network, which is a good place to start exploring, and snapping it back
    // would undo the one change the visitor is most likely to want kept.
    setUndergroundVisible(false);
    setLightingMode("auto");
    setPanelExpanded(null);
    const store = useAppStore.getState();
    store.selectRun(null);
    store.selectStation(null);
    savePreferences({ tourSeen: true });
    setTourOpen(false);
    setStep(0);
  }, [setLightingMode, setPanelExpanded, setTourOpen, setUndergroundVisible]);

  // A detail panel left open from before covers the top-right corner, which
  // is where several steps point. Clear the selection when the tour starts.
  useEffect(() => {
    if (!tourOpen) return;
    const store = useAppStore.getState();
    store.selectRun(null);
    store.selectStation(null);
    store.setAboutOpen(false);
  }, [tourOpen]);

  // Open the panel *before* measuring, so a control inside it has a rect.
  useEffect(() => {
    if (!tourOpen) return;
    if (current.needsPanel) setPanelExpanded(true);
    current.apply?.();
    // `steps` is rebuilt each render (it closes over the current strings), so
    // the step index is the honest dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, step]);

  const measure = useCallback(() => {
    if (!current.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${current.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }

    // Bring the control into view inside its own scroll container FIRST.
    // Several targets live in the left panel's `overflow-y-auto` list, and
    // `getBoundingClientRect()` happily reports the position of an element
    // that has been scrolled out of it — which drew the spotlight over an
    // empty strip at the edge of the panel with an arrow pointing at nothing.
    // `block: "nearest"` scrolls the ancestor only as far as needed and does
    // not yank the window around.
    el.scrollIntoView({ block: "nearest", inline: "nearest" });

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return;
    }
    // Still clipped after scrolling (a collapsed panel, a target genuinely
    // off-screen)? Then there is nothing to point at, and a centred card with
    // no arrow is the honest presentation.
    const visible =
      r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    setRect(visible ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
  }, [current.target]);

  // Measure after the panel has opened and laid out, then keep re-measuring
  // briefly: a step may be pointing at something that appears asynchronously
  // (the train inspector arrives only once the engine answers), and a camera
  // animation moves things under the highlight while it runs.
  useLayoutEffect(() => {
    if (!tourOpen) return;
    measure();
    let frame = 0;
    let elapsed = 0;
    const tick = () => {
      measure();
      elapsed += 100;
      if (elapsed < 3_000) frame = window.setTimeout(tick, 100);
    };
    frame = window.setTimeout(tick, 100);
    return () => clearTimeout(frame);
  }, [tourOpen, step, measure]);

  useEffect(() => {
    if (!tourOpen) return;
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [tourOpen, measure]);

  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourOpen, finish, steps.length]);

  if (!tourOpen) return null;

  const placement = placeCard(rect);

  return (
    <div className="pointer-events-none fixed inset-0 z-50" role="dialog" aria-label={current.title}>
      {/* The scrim. With a target it is a transparent box with a huge shadow
          spread, which darkens everything except the hole. Without one it is a
          plain full-screen dim. */}
      {/* Swallow every click outside the card while the tour is running.
          The spotlight below is drawn with a box-shadow, so its hit area is
          only the hole — without this catcher the dimmed region still passed
          clicks through to the map, and a stray tap would open a train
          inspector on top of the very thing the step was pointing at. The
          tour operates the controls itself, so nothing is lost by making the
          dimmed area inert. */}
      <div aria-hidden className="pointer-events-auto absolute inset-0" />

      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top - HALO,
            left: rect.left - HALO,
            width: rect.width + HALO * 2,
            height: rect.height + HALO * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.66)",
            // A bright rim so the cut-out reads as "this thing", not as a gap.
            outline: "2px solid rgba(255,255,255,0.9)",
            outlineOffset: "-1px",
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-slate-950/55" />
      )}

      {/* Arrow from the card toward the highlighted control. */}
      {rect && placement.arrow && (
        <div
          aria-hidden
          className="absolute transition-all duration-300"
          style={{ top: placement.arrow.top, left: placement.arrow.left }}
        >
          {/* Dark fill with a white rim: the arrow has to be legible against
              BOTH the dimmed scrim and the brightly lit cut-out it points
              into. A plain white arrow vanished the moment it overlapped the
              highlight — which is most of the time, since that is where it
              points. */}
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
            fill="#0f172a"
            stroke="#ffffff"
            strokeWidth="1.6"
            strokeLinejoin="round"
            style={{ transform: `rotate(${placement.arrow.rotate}deg)` }}
          >
            <path d="M12 3 L19 14 L13 12.5 L12 21 L11 12.5 L5 14 Z" />
          </svg>
        </div>
      )}

      <div
        className={`pointer-events-auto absolute flex flex-col gap-3 p-4 ${GLASS}`}
        style={placement.card}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {t.tourLabel} {step + 1}/{steps.length}
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-slate-900">{current.title}</h2>
          </div>
          <button
            type="button"
            onClick={finish}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 pointer-coarse:min-h-11"
          >
            {t.skip}
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-700">{current.body}</p>

        {/* Progress as segments: at thirteen steps a bar reads as "almost
            done" for most of the tour, whereas segments show what is left. */}
        <div className="flex items-center gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-slate-700" : "bg-slate-300"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
            className="rounded-md bg-slate-200/70 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-40 pointer-coarse:min-h-11"
          >
            {t.back}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            className="flex-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 pointer-coarse:min-h-11"
          >
            {isLast ? t.tourFinish : t.next}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Where to put the card, and which way the arrow points.
 *
 * Tries below, above, right, then left of the target, taking the first side
 * with room. Falls back to bottom-centre when there is no target — and on a
 * narrow screen the card is always bottom-docked, because a 340 px card beside
 * a control on a 375 px phone leaves nothing readable.
 */
function placeCard(rect: Rect | null): {
  card: React.CSSProperties;
  arrow: { top: number; left: number; rotate: number } | null;
} {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const narrow = vw < 640;
  const cardW = Math.min(CARD_WIDTH, vw - 24);
  // Enough for title + body + progress + buttons at this width.
  const cardH = 232;

  if (!rect) {
    return {
      card: {
        width: cardW,
        left: (vw - cardW) / 2,
        // Centred vertically for the intro/outro, which have nothing to point at.
        top: Math.max(16, (vh - cardH) / 2),
        borderRadius: 14,
      },
      arrow: null,
    };
  }

  const clampX = (x: number) => Math.min(Math.max(12, x), vw - cardW - 12);
  const clampY = (y: number) => Math.min(Math.max(12, y), vh - cardH - 12);
  const centreX = rect.left + rect.width / 2;

  const below = rect.top + rect.height + CARD_GAP;
  const above = rect.top - CARD_GAP - cardH;

  // On a phone the card always docks to whichever end of the screen the
  // target is not on, full width — side placement is not survivable at 375px.
  if (narrow) {
    const targetInTopHalf = rect.top + rect.height / 2 < vh / 2;
    const top = targetInTopHalf ? Math.min(vh - cardH - 12, below) : Math.max(12, above);
    return {
      card: { width: cardW, left: 12, top, borderRadius: 14 },
      arrow: {
        left: Math.min(Math.max(16, centreX - 14), vw - 44),
        top: targetInTopHalf ? top - 30 : top + cardH + 4,
        // Point up toward a target above the card, down toward one below it.
        rotate: targetInTopHalf ? 0 : 180,
      },
    };
  }

  if (below + cardH < vh - 12) {
    const left = clampX(centreX - cardW / 2);
    return {
      card: { width: cardW, left, top: below, borderRadius: 14 },
      arrow: { left: centreX - 14, top: below - 30, rotate: 0 },
    };
  }
  if (above > 12) {
    const left = clampX(centreX - cardW / 2);
    return {
      card: { width: cardW, left, top: above, borderRadius: 14 },
      arrow: { left: centreX - 14, top: above + cardH + 4, rotate: 180 },
    };
  }

  const rightOf = rect.left + rect.width + CARD_GAP;
  if (rightOf + cardW < vw - 12) {
    const top = clampY(rect.top + rect.height / 2 - cardH / 2);
    return {
      card: { width: cardW, left: rightOf, top, borderRadius: 14 },
      arrow: {
        left: rightOf - 30,
        top: rect.top + rect.height / 2 - 14,
        rotate: -90,
      },
    };
  }

  const leftOf = rect.left - CARD_GAP - cardW;
  const top = clampY(rect.top + rect.height / 2 - cardH / 2);
  return {
    card: { width: cardW, left: Math.max(12, leftOf), top, borderRadius: 14 },
    arrow: {
      left: rect.left + rect.width + 6,
      top: rect.top + rect.height / 2 - 14,
      rotate: 90,
    },
  };
}
