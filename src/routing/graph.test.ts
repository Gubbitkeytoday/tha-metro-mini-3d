import { describe, expect, it } from "vitest";
import { hopSeconds, NetworkGraph, TRANSFER_PENALTY_S, type HopTimes } from "./graph";
import type { StationInfo } from "../sim/protocol";

/**
 * A small synthetic network, because asserting against the real one would
 * make these tests restate the timetable rather than the algorithm:
 *
 *   route 0 (green):  G0 — G1 — G2 — G3        (1 km apart)
 *   route 1 (blue):   B0 — B1 — B2             (1 km apart)
 *   interchange:      G2 <-> B1
 */
function station(
  routeIdx: number,
  stationIdx: number,
  name: string,
  arcKm: number,
  interchanges: { route_idx: number; station_idx: number }[] = [],
): StationInfo {
  return {
    route_idx: routeIdx,
    station_idx: stationIdx,
    code: `${routeIdx}${stationIdx}`,
    name_en: name,
    name_th: name,
    arc_m: arcKm * 1000,
    x: arcKm * 1000,
    y: routeIdx * 500,
    z: 15,
    interchanges,
  };
}

const GREEN = [0, 1, 2, 3].map((i) =>
  station(0, i, `G${i}`, i, i === 2 ? [{ route_idx: 1, station_idx: 1 }] : []),
);
const BLUE = [0, 1, 2].map((i) =>
  station(1, i, `B${i}`, i, i === 1 ? [{ route_idx: 0, station_idx: 2 }] : []),
);
const STATIONS = [...GREEN, ...BLUE];

const HOPS: HopTimes = {
  sampled: new Map(),
  vehicleTypeByRoute: ["heavy", "heavy"],
};

const graph = () => new NetworkGraph(STATIONS, HOPS);

describe("hopSeconds", () => {
  it("uses the real timetable when a hop was sampled", () => {
    const hops: HopTimes = {
      sampled: new Map([[0, new Map([["0->1", 137]])]]),
      vehicleTypeByRoute: ["heavy"],
    };
    expect(hopSeconds(hops, 0, GREEN[0], GREEN[1])).toBe(137);
  });

  it("accepts a sampled hop in either direction", () => {
    const hops: HopTimes = {
      sampled: new Map([[0, new Map([["1->0", 137]])]]),
      vehicleTypeByRoute: ["heavy"],
    };
    expect(hopSeconds(hops, 0, GREEN[0], GREEN[1])).toBe(137);
  });

  it("estimates from distance when nothing was sampled", () => {
    // 1 km at heavy-rail speed plus a dwell — minutes, not seconds or hours.
    const seconds = hopSeconds(HOPS, 0, GREEN[0], GREEN[1]);
    expect(seconds).toBeGreaterThan(60);
    expect(seconds).toBeLessThan(180);
  });

  it("gives a slower fleet a longer hop over the same distance", () => {
    const apm: HopTimes = { sampled: new Map(), vehicleTypeByRoute: ["apm"] };
    expect(hopSeconds(apm, 0, GREEN[0], GREEN[1])).toBeGreaterThan(
      hopSeconds(HOPS, 0, GREEN[0], GREEN[1]),
    );
  });
});

describe("planning a journey", () => {
  it("rides one line with no transfer when both ends are on it", () => {
    const journey = graph().plan(GREEN[0], GREEN[3])!;
    expect(journey).not.toBeNull();
    expect(journey.transfers).toBe(0);
    expect(journey.legs).toHaveLength(1);
    expect(journey.legs[0].kind).toBe("ride");
    expect(journey.legs[0].from.name_en).toBe("G0");
    expect(journey.legs[0].to.name_en).toBe("G3");
  });

  it("collapses consecutive stops into ONE instruction, listing what it passes", () => {
    const leg = graph().plan(GREEN[0], GREEN[3])!.legs[0];
    // "Ride to G3, passing G1 and G2" — not three separate legs.
    expect(leg.stops.map((s) => s.name_en)).toEqual(["G1", "G2"]);
  });

  it("changes lines when it has to, and says where", () => {
    const journey = graph().plan(GREEN[0], BLUE[2])!;
    expect(journey.transfers).toBe(1);
    const kinds = journey.legs.map((l) => l.kind);
    expect(kinds).toEqual(["ride", "transfer", "ride"]);
    // The change happens at the interchange, G2 <-> B1.
    expect(journey.legs[0].to.name_en).toBe("G2");
    expect(journey.legs[1].from.name_en).toBe("G2");
    expect(journey.legs[1].to.name_en).toBe("B1");
    expect(journey.legs[2].to.name_en).toBe("B2");
  });

  it("treats the two platforms of an interchange as the same place", () => {
    // Asking to travel between them is a non-journey, not a transfer.
    const journey = graph().plan(GREEN[2], BLUE[1])!;
    expect(journey.legs).toHaveLength(0);
    expect(journey.totalSeconds).toBe(0);
  });

  it("charges for the change, so a transfer route is not free", () => {
    const journey = graph().plan(GREEN[0], BLUE[2])!;
    expect(journey.totalSeconds).toBeGreaterThan(TRANSFER_PENALTY_S);
  });

  it("prefers staying on one line over an equal-length change", () => {
    // A parallel route 2 shadowing green, reachable only via a transfer:
    // the direct green ride must win.
    const shadow = [0, 1, 2, 3].map((i) =>
      station(2, i, `S${i}`, i, i === 0 ? [{ route_idx: 0, station_idx: 0 }] : []),
    );
    const green = GREEN.map((s, i) =>
      i === 0
        ? { ...s, interchanges: [{ route_idx: 2, station_idx: 0 }] }
        : { ...s, interchanges: [] },
    );
    const g = new NetworkGraph([...green, ...shadow], {
      sampled: new Map(),
      vehicleTypeByRoute: ["heavy", "heavy", "heavy"],
    });
    const journey = g.plan(green[0], green[3])!;
    expect(journey.transfers).toBe(0);
  });

  it("returns null when the two places are not connected", () => {
    const island = [station(5, 0, "X0", 0), station(5, 1, "X1", 1)];
    const g = new NetworkGraph([...STATIONS, ...island], {
      sampled: new Map(),
      vehicleTypeByRoute: ["heavy", "heavy", "heavy", "heavy", "heavy", "heavy"],
    });
    expect(g.plan(GREEN[0], island[1])).toBeNull();
  });

  it("works in both directions and takes the same time", () => {
    const there = graph().plan(GREEN[0], BLUE[2])!;
    const back = graph().plan(BLUE[2], GREEN[0])!;
    expect(back.transfers).toBe(there.transfers);
    expect(back.totalSeconds).toBeCloseTo(there.totalSeconds, 6);
  });

  it("apportions ride time across legs so the parts sum to the total", () => {
    const journey = graph().plan(GREEN[0], BLUE[2])!;
    const sum = journey.legs.reduce((n, l) => n + l.seconds, 0);
    expect(sum).toBeCloseTo(journey.totalSeconds, 3);
  });

  it("lists every platform at an interchange, itself included", () => {
    const platforms = graph().platformsAt(GREEN[2]);
    expect(platforms.map((s) => s.name_en).sort()).toEqual(["B1", "G2"]);
  });
});
