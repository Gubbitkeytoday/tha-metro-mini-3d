import type { LineGeometry, Station } from "../types";
import { UI_LANGUAGES, type UiLanguage } from "./strings";

/**
 * Which languages the app can actually offer, and how well.
 *
 * The list is DERIVED from the loaded network rather than hardcoded, because
 * station names are data we don't own: they come from OpenStreetMap's
 * `name:<lang>` tags. Offering a language the data has never heard of would
 * mean a picker full of options that all silently render English.
 *
 * A language is offered when it either has UI strings or names at least a few
 * stations, and each entry reports its real coverage so the choice is informed
 * instead of a guess.
 */

export interface LanguageOption {
  /** BCP-47-ish subtag, e.g. "th", "zh". */
  code: string;
  /** The language's name in that language ("ไทย", "日本語"), for the picker. */
  endonym: string;
  /** Stations with a name in this language. */
  stationsNamed: number;
  /** Total stations in the network. */
  stationsTotal: number;
  /** Whether the app chrome is translated (vs. falling back to English). */
  hasUiStrings: boolean;
}

/**
 * A language's own name for itself, via `Intl.DisplayNames`.
 *
 * Rendering the picker in each language's own script is the difference between
 * a list a Japanese speaker can scan and a list they have to translate first.
 * Falls back to the bare code when the runtime has no display name — which is
 * still more useful than an English label they may not read.
 */
export function endonymFor(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (!name || name === code) return code;
    // Some locales lower-case their endonym; a picker reads better capitalised.
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** Minimum stations a data-only language must name to be worth offering. */
const MIN_STATION_COVERAGE = 3;

/** Build the picker's options from the loaded network. */
export function availableLanguages(lines: LineGeometry[]): LanguageOption[] {
  const stations = lines.flatMap((l) => l.stations);
  const total = stations.length;

  const counts = new Map<string, number>();
  for (const station of stations) {
    for (const code of Object.keys(station.names ?? {})) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const codes = new Set<string>([...counts.keys(), ...UI_LANGUAGES]);

  // Recount English and Thai through `hasNativeName`, the same predicate the
  // label builder uses. Both also live in the legacy `name`/`nameTh` fields —
  // OSM's untagged default `name` for a Bangkok station is the Thai one — and
  // counting only `names[code]` under-reported Thai as 151/195 while every
  // one of those 195 labels was in fact rendering in Thai. The percentage in
  // the picker is a promise about what you will see; it has to be measured
  // the same way the thing you see is chosen.
  for (const code of codes) {
    if (code !== "en" && code !== "th") continue;
    counts.set(code, stations.filter((s) => hasNativeName(s, code)).length);
  }

  return [...codes]
    .map((code) => ({
      code,
      endonym: endonymFor(code),
      stationsNamed: counts.get(code) ?? 0,
      stationsTotal: total,
      hasUiStrings: (UI_LANGUAGES as readonly string[]).includes(code),
    }))
    .filter((o) => o.hasUiStrings || o.stationsNamed >= MIN_STATION_COVERAGE)
    // Best-covered first, then translated chrome, then alphabetical — so the
    // languages that actually work well are the ones at the top.
    .sort(
      (a, b) =>
        b.stationsNamed - a.stationsNamed ||
        Number(b.hasUiStrings) - Number(a.hasUiStrings) ||
        a.code.localeCompare(b.code),
    );
}

/**
 * The station's name in `language`, and nothing else.
 *
 * "Thai means Thai only" is the requirement, so this returns ONE string rather
 * than the bilingual pair the labels used to show. The fallback chain is
 * deliberate and ordered by usefulness: the requested language, then English
 * (the widest coverage by far, and readable to most visitors), then Thai (the
 * local name, always correct even if unreadable to some), then the code.
 * Something is always better than a blank sign.
 */
export function stationName(station: Station, language: string): string {
  const names = station.names ?? {};
  return (
    names[language] ||
    // A regional tag like "zh-Hant" should still find plain "zh".
    names[language.split("-")[0]] ||
    (language === "en" ? station.name : "") ||
    (language === "th" ? station.nameTh : "") ||
    names.en ||
    station.name ||
    names.th ||
    station.nameTh ||
    station.code ||
    ""
  );
}

/**
 * The line's name in `language`.
 *
 * Lines only carry English and Thai — those are the two the registry
 * (`tools/lines.config.mjs`) authors by hand, and unlike stations there are no
 * `name:<lang>` tags to harvest for the ten of them. Every other language
 * therefore gets the English name, which is the honest outcome rather than a
 * machine-translated guess at an operator's brand name.
 */
export function lineName(line: Pick<LineGeometry, "name" | "nameTh">, language: string): string {
  if (language === "th" && line.nameTh) return line.nameTh;
  return line.name || line.nameTh || "";
}

/** True when this station really has a name in the chosen language. */
export function hasNativeName(station: Station, language: string): boolean {
  const names = station.names ?? {};
  if (names[language] || names[language.split("-")[0]]) return true;
  if (language === "en" && station.name) return true;
  if (language === "th" && station.nameTh) return true;
  return false;
}

/**
 * Localise a station name that came from the ENGINE rather than from
 * `network.json`.
 *
 * The inspector and the station board are fed by the Wasm engine, whose
 * `StationInfo` carries only `name_en` / `name_th` — the binary cache format
 * predates multilingual names and widening it would mean a schema change, a
 * Rust release and a rebuilt cache for data the frontend already holds.
 *
 * So this bridges the two by English name. Route index is deliberately NOT
 * part of the key: the engine drops stations the registry excludes (the Pink
 * Line's Muang Thong Thani spur), so engine and `network.json` indices are not
 * guaranteed to line up, whereas the English name is what the preprocessor
 * copied across verbatim. Two lines sharing a name are an interchange and want
 * the same translation anyway.
 */
export function buildNameIndex(lines: LineGeometry[]): Map<string, Station> {
  const index = new Map<string, Station>();
  for (const line of lines) {
    for (const station of line.stations) {
      if (station.name) index.set(station.name, station);
    }
  }
  return index;
}

/** Localise `{ name_en, name_th }` through the index, falling back to itself. */
export function localiseEngineName(
  index: Map<string, Station>,
  engineStation: { name_en: string; name_th: string },
  language: string,
): string {
  const match = index.get(engineStation.name_en);
  if (match) return stationName(match, language);
  if (language === "th" && engineStation.name_th) return engineStation.name_th;
  return engineStation.name_en || engineStation.name_th || "";
}

/**
 * The language asked for in the URL (`?lang=th`), or null.
 *
 * This outranks both the saved preference and the browser's own list, and it
 * has to: it is what the sitemap's hreflang alternates point at, so a Thai
 * search result must actually open in Thai even for a returning visitor whose
 * last choice was English — and it is how someone shares "this map, in your
 * language" with another person.
 */
export function urlLanguage(offered: readonly string[] = UI_LANGUAGES): string | null {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (!requested) return null;
  if (offered.includes(requested)) return requested;
  const base = requested.split("-")[0];
  return offered.includes(base) ? base : null;
}

/**
 * The best initial language: the first of the browser's preferred languages
 * that the app can actually serve, else English.
 *
 * `navigator.languages` is ordered by the user's own preference, so honouring
 * it is strictly better than guessing from a single `navigator.language` or
 * defaulting everyone to English.
 */
export function preferredLanguage(offered: readonly string[] = UI_LANGUAGES): UiLanguage | string {
  const fromUrl = urlLanguage(offered);
  if (fromUrl) return fromUrl;

  const wanted = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const tag of wanted) {
    if (!tag) continue;
    if (offered.includes(tag)) return tag;
    const base = tag.split("-")[0];
    if (offered.includes(base)) return base;
  }
  return "en";
}
