import type { InterchangeRef, StationInfo } from "../sim/protocol";

/**
 * Journey planning over the rail network.
 *
 * The audience for this is someone who has just arrived in Bangkok, knows the
 * name of where they want to go and nothing else. So the answer has to be
 * "board the green line here, change at Asok, get off at the fourth stop" —
 * not a travel time. Everything below exists to produce that sentence.
 *
 * ## The graph
 *
 * A node is one platform: a `(routeIdx, stationIdx)` pair, NOT a place. Asok
 * on the Sukhumvit Line and Asok on the Blue Line are two nodes joined by a
 * transfer edge, which is what makes "change here" fall out of the search
 * instead of having to be special-cased.
 *
 * Two kinds of edge:
 * - **Ride** — consecutive stations on one route, in both directions. Its cost
 *   is the real scheduled running time where the timetable could be sampled,
 *   and a distance estimate where it could not (see `hopSeconds`).
 * - **Transfer** — the engine's own interchange links, which are built from
 *   real geometry (any two routes' platforms within 300 m, plus a manual list
 *   for the walkways that radius cannot see). Cost is a flat penalty, because
 *   the thing that actually costs you time at an interchange is the wait for
 *   the next train, not the walk.
 *
 * ## Why cost is time, but the tie-break is transfers
 *
 * Given two routes of similar length people overwhelmingly prefer the one with
 * fewer changes — a change carries a risk of getting lost that a few extra
 * minutes on a train does not, and that matters most to exactly the person
 * this feature is for. The transfer penalty below is deliberately generous for
 * that reason: it is not a claim about walking speed.
 */

/** Flat cost of changing lines, in seconds. See the note above. */
export const TRANSFER_PENALTY_S = 300;

/** Assumed dwell at each intermediate stop when estimating, in seconds. */
const ESTIMATED_DWELL_S = 25;

/** Fallback running speeds by vehicle type, m/s, when no timetable is available. */
const FALLBACK_SPEED_MS: Record<string, number> = {
  heavy: 12.5,
  monorail: 10.5,
  apm: 8.5,
  commuter: 16,
};

export interface JourneyLeg {
  kind: "ride" | "transfer";
  routeIdx: number;
  /** Platform boarded (ride) or left (transfer). */
  from: StationInfo;
  /** Platform alighted (ride) or arrived at (transfer). */
  to: StationInfo;
  /** Intermediate stops passed, excluding both ends. */
  stops: StationInfo[];
  seconds: number;
  /** Travel direction along the route, for naming the platform's headsign. */
  towards: StationInfo | null;
}

export interface Journey {
  legs: JourneyLeg[];
  totalSeconds: number;
  transfers: number;
}

const key = (routeIdx: number, stationIdx: number) => `${routeIdx}:${stationIdx}`;

/**
 * Per-route running time between adjacent stations.
 *
 * `sampled` maps `routeIdx` to that route's own scheduled hop times, taken
 * from a real run; `undefined` for a route means no run could be sampled (the
 * network is shut at this hour, or the engine is still warming up) and the
 * estimate is used instead.
 */
export interface HopTimes {
  sampled: Map<number, Map<string, number>>;
  vehicleTypeByRoute: string[];
}

/** Seconds to ride from one station to the next along `routeIdx`. */
export function hopSeconds(
  hops: HopTimes,
  routeIdx: number,
  a: StationInfo,
  b: StationInfo,
): number {
  const sampled = hops.sampled.get(routeIdx);
  const direct = sampled?.get(`${a.station_idx}->${b.station_idx}`);
  if (direct !== undefined && direct > 0) return direct;
  // Same pair the other way round: a timetable gives one direction, but the
  // running time is symmetrical enough for planning.
  const reverse = sampled?.get(`${b.station_idx}->${a.station_idx}`);
  if (reverse !== undefined && reverse > 0) return reverse;

  const metres = Math.abs(b.arc_m - a.arc_m);
  const speed = FALLBACK_SPEED_MS[hops.vehicleTypeByRoute[routeIdx]] ?? 12;
  return metres / speed + ESTIMATED_DWELL_S;
}

interface Edge {
  to: string;
  seconds: number;
  transfer: boolean;
}

/** Adjacency built once per (stations, hop-times) pair and reused per search. */
export class NetworkGraph {
  private nodes = new Map<string, StationInfo>();
  private edges = new Map<string, Edge[]>();

  constructor(stations: StationInfo[], hops: HopTimes) {
    for (const station of stations) {
      this.nodes.set(key(station.route_idx, station.station_idx), station);
    }

    // Ride edges. Stations on a route are ordered along the track, so
    // consecutive `station_idx` values are physically adjacent — the same
    // ordering `arc_m` is monotonic in.
    const byRoute = new Map<number, StationInfo[]>();
    for (const station of stations) {
      const list = byRoute.get(station.route_idx) ?? [];
      list.push(station);
      byRoute.set(station.route_idx, list);
    }
    for (const [routeIdx, list] of byRoute) {
      list.sort((a, b) => a.station_idx - b.station_idx);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        const seconds = hopSeconds(hops, routeIdx, a, b);
        this.link(key(routeIdx, a.station_idx), key(routeIdx, b.station_idx), seconds, false);
        this.link(key(routeIdx, b.station_idx), key(routeIdx, a.station_idx), seconds, false);
      }
    }

    // Transfer edges, from the engine's own interchange metadata.
    for (const station of stations) {
      for (const other of station.interchanges as InterchangeRef[]) {
        const from = key(station.route_idx, station.station_idx);
        const to = key(other.route_idx, other.station_idx);
        if (!this.nodes.has(to)) continue;
        this.link(from, to, TRANSFER_PENALTY_S, true);
      }
    }
  }

  private link(from: string, to: string, seconds: number, transfer: boolean): void {
    const list = this.edges.get(from) ?? [];
    list.push({ to, seconds, transfer });
    this.edges.set(from, list);
  }

  /** Every platform serving the same place as `station`, including itself. */
  platformsAt(station: StationInfo): StationInfo[] {
    const out = [station];
    for (const other of station.interchanges as InterchangeRef[]) {
      const found = this.nodes.get(key(other.route_idx, other.station_idx));
      if (found) out.push(found);
    }
    return out;
  }

  /**
   * Cheapest journey between two places, considering every platform at each.
   *
   * Dijkstra rather than A*: the graph is a couple of hundred nodes, so the
   * heuristic would save nothing measurable and would need a distance metric
   * that stays admissible across the transfer penalty — a way to introduce a
   * subtle wrong-answer bug for no gain.
   */
  plan(origin: StationInfo, destination: StationInfo): Journey | null {
    const starts = this.platformsAt(origin).map((s) => key(s.route_idx, s.station_idx));
    const goals = new Set(
      this.platformsAt(destination).map((s) => key(s.route_idx, s.station_idx)),
    );
    if (starts.some((s) => goals.has(s))) return { legs: [], totalSeconds: 0, transfers: 0 };

    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; transfer: boolean }>();
    const visited = new Set<string>();
    for (const s of starts) dist.set(s, 0);

    let goal: string | null = null;
    // Linear scan for the minimum: at this size a binary heap is slower once
    // its bookkeeping is counted, and much easier to get wrong.
    for (;;) {
      let current: string | null = null;
      let best = Infinity;
      for (const [node, d] of dist) {
        if (visited.has(node) || d >= best) continue;
        current = node;
        best = d;
      }
      if (current === null) break;
      if (goals.has(current)) {
        goal = current;
        break;
      }
      visited.add(current);
      for (const edge of this.edges.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        const next = best + edge.seconds;
        if (next < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, next);
          prev.set(edge.to, { node: current, transfer: edge.transfer });
        }
      }
    }
    if (goal === null) return null;

    // Walk the predecessors back to a start, then turn the node chain into
    // legs a person can follow.
    //
    // `prev.get(n).transfer` describes the edge that led INTO `n`, so the flag
    // belongs on `n`'s own chain entry — attaching it to the predecessor
    // instead shifts every change one station early, which is how the planner
    // first came to announce a change at G1 for an interchange at G2.
    const chain: { node: string; transfer: boolean }[] = [];
    let node = goal;
    while (prev.has(node)) {
      const step = prev.get(node)!;
      chain.push({ node, transfer: step.transfer });
      node = step.node;
    }
    chain.push({ node, transfer: false }); // the boarding platform
    chain.reverse();

    return this.toLegs(chain, dist.get(goal) ?? 0);
  }

  private toLegs(
    chain: { node: string; transfer: boolean }[],
    totalSeconds: number,
  ): Journey {
    const legs: JourneyLeg[] = [];
    let i = 0;
    while (i < chain.length - 1) {
      const isTransfer = chain[i + 1].transfer;
      const from = this.nodes.get(chain[i].node)!;

      if (isTransfer) {
        const to = this.nodes.get(chain[i + 1].node)!;
        legs.push({
          kind: "transfer",
          routeIdx: to.route_idx,
          from,
          to,
          stops: [],
          seconds: TRANSFER_PENALTY_S,
          towards: null,
        });
        i += 1;
        continue;
      }

      // Absorb every consecutive ride on the same route into one leg — "ride
      // four stops" is a single instruction, not four.
      let j = i + 1;
      const passed: StationInfo[] = [];
      while (j < chain.length && !chain[j].transfer) {
        const node = this.nodes.get(chain[j].node)!;
        if (node.route_idx !== from.route_idx) break;
        if (j < chain.length - 1 && !chain[j + 1].transfer) {
          const after = this.nodes.get(chain[j + 1].node)!;
          if (after.route_idx === from.route_idx) passed.push(node);
        }
        j++;
      }
      const to = this.nodes.get(chain[j - 1].node)!;
      if (to === from) {
        i = j;
        continue;
      }
      legs.push({
        kind: "ride",
        routeIdx: from.route_idx,
        from,
        to,
        stops: passed,
        seconds: 0,
        towards: to,
      });
      i = j - 1;
    }

    // Fill ride durations from the leg ends so the numbers add up to the total
    // the search actually found.
    const transferSeconds = legs.filter((l) => l.kind === "transfer").length * TRANSFER_PENALTY_S;
    const rideSeconds = Math.max(0, totalSeconds - transferSeconds);
    const rideLegs = legs.filter((l) => l.kind === "ride");
    const totalStops = rideLegs.reduce((n, l) => n + l.stops.length + 1, 0) || 1;
    for (const leg of rideLegs) {
      leg.seconds = (rideSeconds * (leg.stops.length + 1)) / totalStops;
    }

    return {
      legs,
      totalSeconds,
      transfers: legs.filter((l) => l.kind === "transfer").length,
    };
  }
}
