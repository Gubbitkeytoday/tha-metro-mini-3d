import type { ReactNode } from "react";
import { GLASS, GLASS_DIVIDER } from "./glass";

/**
 * The shell shared by the train inspector and the station board.
 *
 * One component because the two panels are the same object in the interface —
 * "the detail view for whatever you just tapped" — and they must never be able
 * to drift apart in shape, position or breakpoint behaviour. They are also
 * mutually exclusive (selecting a train clears the station and vice versa), so
 * they occupy the same slot.
 *
 * Two layouts, one component:
 *
 * - **≥ sm (tablet, laptop, desktop):** a floating card pinned top-right,
 *   clear of the line selector on the left and the time controls at the
 *   bottom.
 * - **< sm (phones):** a bottom sheet. A 288 px card on a 390 px screen leaves
 *   no map, and top-right would collide with the line-selector button. The
 *   sheet deliberately covers the time controls — the same thing a maps app
 *   does with a place card — and closing it brings them back, so nothing
 *   becomes unreachable.
 *
 * `max-h` is capped so the map stays partly visible in both layouts; the body
 * scrolls inside rather than the sheet growing off-screen.
 */
export function OverlayPanel({
  title,
  subtitle,
  accent,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Optional colour dot — the line's livery on the inspector. */
  accent?: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        `pointer-events-auto z-30 flex flex-col overflow-hidden ${GLASS}`,
        // Phone: bottom sheet spanning the width, rounded at the top only.
        "fixed inset-x-0 bottom-0 max-h-[72dvh] rounded-t-2xl pb-safe-b",
        // Tablet and up: floating card, top-right.
        "sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-72 sm:rounded-xl sm:pb-0",
        "sm:max-h-[calc(100dvh-2rem)]",
        // Wide screens can afford a roomier card without crowding the map.
        "xl:w-80",
      ].join(" ")}
      role="dialog"
      aria-label={title}
      // The guided tour spotlights this panel on the "tap a train" step, after
      // selecting a train so it is actually on screen to point at.
      data-tour="detail"
    >
      {/* Grab-handle affordance — reads as a sheet on touch, hidden on the
          floating-card layouts where it would be meaningless. */}
      <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-slate-300" />
      </div>

      <div className={`flex items-start gap-2 border-b px-4 py-3 ${GLASS_DIVIDER}`}>
        {accent && (
          <span
            className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          {subtitle !== undefined && (
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          // 44 px on any coarse pointer — a tablet is a touch device at a
          // desktop width, so this is keyed on the pointer, not the breakpoint.
          className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-lg"
        >
          ×
        </button>
      </div>

      {children}
    </div>
  );
}
