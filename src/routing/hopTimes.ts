import type { SimClient } from "../sim/SimClient";
import type { StationInfo } from "../sim/protocol";
import type { HopTimes } from "./graph";

/**
 * Station-to-station running times, taken from the published timetable.
 *
 * The planner could estimate every hop from track distance and an assumed
 * speed, and it falls back to that. But this app already owns the real
 * schedule, and using it is the difference between "about 18 minutes" and the
 * actual 22 the operator publishes — on a network where the Airport Rail Link
 * and a monorail sit on the same map, an assumed speed is wrong by a lot.
 *
 * Sampling one run per route is enough: within a route the running times are
 * fixed by the pattern, so any full-length run yields the whole table. It runs
 * once, off the frame path, the first time the planner is opened.
 */

/** How long to wait for the engine before giving up on a route. */
const QUERY_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Ask the engine for one representative run per route and read its hop times.
 *
 * A route with no live run at the current clock — the network is shut, or it
 * is a track-only line — simply gets no entry, and `hopSeconds` estimates for
 * it instead. That is why this returns partial data rather than failing.
 */
export async function sampleHopTimes(
  client: SimClient,
  stations: StationInfo[],
  vehicleTypeByRoute: string[],
): Promise<HopTimes> {
  const sampled = new Map<number, Map<string, number>>();
  const routes = [...new Set(stations.map((s) => s.route_idx))];
  const now = client.getSimNow();

  await Promise.all(
    routes.map(async (routeIdx) => {
      const onRoute = stations
        .filter((s) => s.route_idx === routeIdx)
        .sort((a, b) => a.station_idx - b.station_idx);
      if (onRoute.length < 2) return;

      // Any station will do as a place to find a run; the first one is where
      // full-length runs start, so it is the most likely to give a complete
      // stop list in one query.
      const board = await withTimeout(
        client.getStationBoard(routeIdx, onRoute[0].station_idx, now, 1),
        QUERY_TIMEOUT_MS,
      );
      const runIdx = board?.entries?.[0]?.run_idx;
      if (runIdx === undefined) return;

      const detail = await withTimeout(client.getRunDetail(runIdx, now), QUERY_TIMEOUT_MS);
      if (!detail || detail.stops.length < 2) return;

      const table = new Map<string, number>();
      for (let i = 1; i < detail.stops.length; i++) {
        const previous = detail.stops[i - 1];
        const current = detail.stops[i];
        const seconds = current.arrival_sec - previous.arrival_sec;
        // A non-positive delta means the run wrapped past midnight between
        // these two calls; skip it rather than record a negative hop.
        if (seconds > 0) {
          table.set(`${previous.station_idx}->${current.station_idx}`, seconds);
        }
      }
      if (table.size > 0) sampled.set(routeIdx, table);
    }),
  );

  return { sampled, vehicleTypeByRoute };
}
