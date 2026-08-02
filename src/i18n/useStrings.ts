import { useAppStore } from "../stores/useAppStore";
import { stringsFor, type Strings } from "./strings";

/**
 * The UI strings for the currently selected language.
 *
 * A hook rather than a module-level lookup so a language change re-renders the
 * components that display text — the alternative is stale English sitting in
 * panels until something else happens to re-render them.
 */
export function useStrings(): Strings {
  const language = useAppStore((s) => s.language);
  return stringsFor(language);
}

/** The selected language tag, for `Intl` formatting and station-name lookup. */
export function useLanguage(): string {
  return useAppStore((s) => s.language);
}
