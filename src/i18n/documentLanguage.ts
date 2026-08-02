import { stringsFor } from "./strings";

/**
 * Keep the document itself in step with the chosen language.
 *
 * Three things depend on this and none of them can see React state:
 *
 * - `<html lang>` tells a screen reader which voice and pronunciation rules to
 *   use, and the browser which hyphenation and font fallbacks to apply. Leaving
 *   it at "en" while the page shows Thai actively degrades accessibility.
 * - `<title>` is what a tab, a bookmark and a shared link show.
 * - The canonical `?lang=` on the URL makes the current view shareable and
 *   matches the hreflang alternates in `index.html`, so a link someone sends
 *   opens in the language they were looking at.
 *
 * The URL is updated with `replaceState`, not `pushState`: switching language
 * is not a navigation, and filling the back button with language changes would
 * make Back stop meaning "the previous thing I looked at".
 */
export function applyDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;

  document.documentElement.lang = language;

  const t = stringsFor(language);
  // Keep the descriptive half of the title — a bare app name is a weak result
  // in a search listing and a weak preview in a chat.
  document.title =
    language === "en"
      ? "Bangkok Metro 3D — live BTS, MRT, SRT & Airport Rail Link map"
      : `${t.appTitle} — Bangkok Metro 3D`;

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("lang") !== language) {
      url.searchParams.set("lang", language);
      window.history.replaceState(null, "", url);
    }
  } catch {
    // Some embedding contexts forbid history access; the language still works.
  }
}
