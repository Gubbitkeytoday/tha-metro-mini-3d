import type { Station } from "../types";
import type { StationInfo } from "../sim/protocol";

/**
 * Station search for someone who does not know the network.
 *
 * The person this is for has a name in their head — from a hotel booking, a
 * friend, a sign — and no idea which line it is on or how it is spelled here.
 * So a match has to be found across **every** name the station has, in every
 * language OpenStreetMap gave us, plus its code, regardless of the language
 * the interface happens to be in. Someone reading the Japanese UI who types
 * "Asok" must still find アソーク駅, and someone typing "E4" must find it too.
 *
 * Deliberately not fuzzy in the edit-distance sense. Substring matching on a
 * normalised string is predictable — you can see why something matched — while
 * a similarity score on 195 short proper nouns in six scripts mostly produces
 * confident nonsense.
 */

export interface SearchEntry {
  /** The engine platform, which is what the planner and the map both take. */
  station: StationInfo;
  routeIdx: number;
  /** Every string this station can be found by, already normalised. */
  haystack: string[];
  /** Places served by more than one line rank above single-line stops. */
  interchange: boolean;
}

export interface SearchResult {
  entry: SearchEntry;
  /** Lower is better. */
  rank: number;
}

/**
 * Casefold and strip the marks that stop a plain comparison from working.
 *
 * `NFKD` + combining-mark removal lets "Phaya Thai" match "Phayathai" once
 * spacing is dropped, and makes accented Latin (Français station names) match
 * an unaccented query. Thai combining vowels and tone marks are NOT stripped —
 * removing them changes the word rather than normalising it — so Thai matches
 * on its own exact characters, which is what a Thai speaker types anyway.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\-_.()·,]/g, "");
}

/**
 * Build the index.
 *
 * `byEnglishName` supplies the multilingual names, because the engine's
 * `StationInfo` only carries English and Thai — the same bridge the labels
 * use, and for the same reason (see `localiseEngineName`).
 */
export function buildSearchIndex(
  stations: StationInfo[],
  byEnglishName: Map<string, Station>,
): SearchEntry[] {
  return stations.map((station) => {
    const extra = byEnglishName.get(station.name_en);
    const names = [
      station.name_en,
      station.name_th,
      station.code,
      ...Object.values(extra?.names ?? {}),
      extra?.name ?? "",
      extra?.nameTh ?? "",
    ];
    return {
      station,
      routeIdx: station.route_idx,
      haystack: [...new Set(names.filter(Boolean).map(normalise))],
      interchange: station.interchanges.length > 0,
    };
  });
}

/**
 * Rank matches for `query`.
 *
 * Ranking, best first:
 * 1. exact match on a whole name or code
 * 2. a name that starts with the query
 * 3. a name that contains it
 *
 * with interchanges promoted within each tier, because a newcomer searching a
 * name that exists on several lines almost always means the interchange.
 *
 * `sameStationLimit` collapses the platforms of one place: Asok appears once,
 * not once per line, or a two-line station would push everything else off a
 * short list.
 */
export function searchStations(
  index: SearchEntry[],
  query: string,
  limit = 8,
): SearchResult[] {
  const q = normalise(query);
  if (q.length === 0) return [];

  const results: SearchResult[] = [];
  for (const entry of index) {
    let best = Infinity;
    for (const name of entry.haystack) {
      if (name === q) best = Math.min(best, 0);
      else if (name.startsWith(q)) best = Math.min(best, 1);
      else if (name.includes(q)) best = Math.min(best, 2);
    }
    if (best === Infinity) continue;
    results.push({ entry, rank: best * 2 + (entry.interchange ? 0 : 1) });
  }

  results.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.station.name_en.length - b.entry.station.name_en.length ||
      a.entry.station.name_en.localeCompare(b.entry.station.name_en),
  );

  // One row per PLACE. The first platform to appear wins, and because the
  // sort has already promoted interchanges, that is the one worth offering.
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  for (const result of results) {
    const placeKey = normalise(result.entry.station.name_en);
    if (seen.has(placeKey)) continue;
    seen.add(placeKey);
    unique.push(result);
    if (unique.length >= limit) break;
  }
  return unique;
}
