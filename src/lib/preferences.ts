/**
 * Remembering the user's view settings between visits.
 *
 * ## Why there is no cookie banner
 *
 * This app sets **no cookies at all** and sends nothing to a server it owns:
 * there is no analytics, no accounts, no ad network, no third-party embeds.
 * The only thing stored is the handful of view preferences below, in
 * `localStorage`, on the visitor's own device.
 *
 * Consent banners exist for *non-essential* storage — analytics, advertising,
 * cross-site tracking. Storage that exists solely to honour a setting the user
 * themselves chose is exempt under both the EU ePrivacy rules ("strictly
 * necessary for a service explicitly requested by the subscriber or user") and
 * Thailand's PDPA. Adding a banner anyway would be consent theatre: it trains
 * people to click through dialogs and it would be asking permission for
 * something that needs none.
 *
 * What is honest instead is *saying so plainly*, which the About panel does.
 *
 * Two rules keep that promise true, and any future change must keep them:
 * 1. Only user-chosen view settings go in here. Never anything identifying,
 *    never a device id, never a location.
 * 2. If analytics or any third-party script is ever added, this comment stops
 *    being true and a real consent flow becomes mandatory.
 */

const KEY = "metro3d.preferences.v1";

/** Exactly the settings worth surviving a reload — nothing else. */
export interface StoredPreferences {
  language?: string;
  showStationLabels?: boolean;
  undergroundVisible?: boolean;
  buildings?: boolean;
  shadows?: boolean;
  lightingMode?: "auto" | "day" | "night";
  hiddenRoutes?: number[];
  /** Whether the guided tour has already been completed or skipped. */
  tourSeen?: boolean;
}

/**
 * Read stored preferences.
 *
 * Never throws: `localStorage` is unavailable in private-mode Safari and when
 * a browser blocks storage for the origin, and a visualisation must not fail
 * to start because it could not remember a toggle.
 */
export function loadPreferences(): StoredPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StoredPreferences;
  } catch {
    return {};
  }
}

/** Merge and persist. Silently does nothing when storage is unavailable. */
export function savePreferences(patch: StoredPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPreferences(), ...patch }));
  } catch {
    // Storage disabled or full — the app works fine without persistence.
  }
}

/** Forget everything this app has stored. Offered in the About panel. */
export function clearPreferences(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
