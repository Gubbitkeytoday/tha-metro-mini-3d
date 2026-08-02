import { describe, expect, it } from "vitest";
import { buildSearchIndex, normalise, searchStations } from "./search";
import type { StationInfo } from "../sim/protocol";
import type { Station } from "../types";

function platform(
  routeIdx: number,
  stationIdx: number,
  nameEn: string,
  nameTh: string,
  code: string,
  interchanges: { route_idx: number; station_idx: number }[] = [],
): StationInfo {
  return {
    route_idx: routeIdx,
    station_idx: stationIdx,
    code,
    name_en: nameEn,
    name_th: nameTh,
    arc_m: stationIdx * 1000,
    x: 0,
    y: 0,
    z: 15,
    interchanges,
  };
}

function place(nameEn: string, names: Record<string, string>): Station {
  return {
    id: nameEn,
    name: nameEn,
    nameTh: names.th ?? "",
    names,
    code: "",
    position: [100.5, 13.7, 15],
  };
}

const PLATFORMS = [
  platform(0, 4, "Asok", "อโศก", "E4", [{ route_idx: 9, station_idx: 12 }]),
  platform(9, 12, "Sukhumvit", "สุขุมวิท", "BL22", [{ route_idx: 0, station_idx: 4 }]),
  platform(0, 1, "Phaya Thai", "พญาไท", "N2"),
  platform(0, 7, "Phrom Phong", "พร้อมพงษ์", "E5"),
  platform(1, 2, "Sala Daeng", "ศาลาแดง", "S2"),
];

const NAMES = new Map<string, Station>([
  ["Asok", place("Asok", { en: "Asok", th: "อโศก", ja: "アソーク駅", zh: "阿速" })],
  ["Phaya Thai", place("Phaya Thai", { en: "Phaya Thai", th: "พญาไท" })],
]);

const index = buildSearchIndex(PLATFORMS, NAMES);
const names = (q: string) => searchStations(index, q).map((r) => r.entry.station.name_en);

describe("normalise", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(normalise("Phaya Thai")).toBe(normalise("phayathai"));
    expect(normalise("Sala-Daeng")).toBe(normalise("sala daeng"));
  });

  it("strips Latin accents so an unaccented query still matches", () => {
    expect(normalise("Café")).toBe(normalise("cafe"));
  });

  it("leaves Thai vowels and tone marks intact", () => {
    // Stripping these would change the word, not normalise it.
    expect(normalise("อโศก")).toBe("อโศก");
  });
});

describe("searching", () => {
  it("finds a station by its English name", () => {
    expect(names("asok")).toContain("Asok");
  });

  it("finds it by its Thai name", () => {
    expect(names("อโศก")).toContain("Asok");
  });

  it("finds it by a name in a language the UI is not in", () => {
    // Someone reading the Japanese interface, or pasting a Japanese name.
    expect(names("アソーク")).toContain("Asok");
  });

  it("finds it by station code", () => {
    expect(names("E4")).toContain("Asok");
    expect(names("s2")).toContain("Sala Daeng");
  });

  it("matches a name typed without its space", () => {
    expect(names("phayathai")).toContain("Phaya Thai");
  });

  it("matches partway through a name", () => {
    expect(names("daeng")).toContain("Sala Daeng");
  });

  it("ranks an exact match above a mere prefix", () => {
    // "Phrom Phong" and "Phaya Thai" both start with "Ph"; asking for the
    // exact one must not bury it.
    expect(names("phrom phong")[0]).toBe("Phrom Phong");
  });

  it("shows one row per place, not one per platform", () => {
    // Asok and Sukhumvit are the same interchange from two lines, but they are
    // different names, so both may appear — what must not happen is the SAME
    // name twice.
    const results = names("a");
    expect(new Set(results).size).toBe(results.length);
  });

  it("promotes an interchange over a single-line stop in the SAME tier", () => {
    // "Sukhumvit" and "Sala Daeng" both begin with "s", so they tie on match
    // quality; the interchange breaks the tie. (Interchange-ness does not beat
    // a better match: "Sala Daeng" rightly outranks "Asok" for "s", because a
    // prefix match is a better answer than a mid-word one.)
    const results = searchStations(index, "s");
    const sukhumvit = results.find((r) => r.entry.station.name_en === "Sukhumvit")!;
    const salaDaeng = results.find((r) => r.entry.station.name_en === "Sala Daeng")!;
    expect(sukhumvit.rank).toBeLessThan(salaDaeng.rank);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchStations(index, "")).toEqual([]);
    expect(searchStations(index, "   ")).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(names("zzzzz")).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(searchStations(index, "a", 2).length).toBeLessThanOrEqual(2);
  });
});
