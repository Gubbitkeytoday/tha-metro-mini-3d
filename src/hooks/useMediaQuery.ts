import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * Most of the responsive work in this app is plain Tailwind breakpoints —
 * reach for this only where the *structure* changes rather than the styling
 * (a panel that is a floating card on a laptop but a bottom sheet on a phone
 * needs different default open/closed behaviour, not just different classes).
 *
 * `useSyncExternalStore` rather than useState+useEffect: it reads the correct
 * value on the very first render instead of flashing the desktop layout for a
 * frame on a phone.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // Server/prerender fallback: assume the roomy layout.
    () => false,
  );
}

/**
 * Phone-sized viewports — Tailwind's `sm` breakpoint, so JS and CSS agree on
 * where the layout changes. A portrait iPad (768px) is deliberately NOT
 * compact: it has room for the floating panels.
 */
export const COMPACT_QUERY = "(max-width: 639.98px)";

/** True on phone-sized viewports (below Tailwind's `sm`). */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

/**
 * Short viewports — a landscape phone is ~390 px tall, where a full-height
 * line list and a two-row time bar leave no map visible at all.
 */
export function useIsShort(): boolean {
  return useMediaQuery("(max-height: 520px)");
}
