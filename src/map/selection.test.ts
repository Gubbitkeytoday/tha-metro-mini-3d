import { describe, expect, it, vi } from "vitest";
import { LANE_ROUTE_IDX, LANE_RUN_IDX, VEHICLE_STRIDE } from "../sim/protocol";
import { pickAt } from "./selection";

/** Minimal MapLibre stand-in: everything projects to a fixed screen point. */
function fakeMap(px: { x: number; y: number }) {
  return {
    project: vi.fn(() => px),
    getCanvas: () => ({ clientWidth: 800, clientHeight: 600, width: 800, height: 600 }),
  } as never;
}

function vehicle(routeIdx: number, runIdx: number): Float32Array {
  const buf = new Float32Array(VEHICLE_STRIDE);
  buf[LANE_ROUTE_IDX] = routeIdx;
  buf[LANE_RUN_IDX] = runIdx;
  return buf;
}

describe("pickAt visibility", () => {
  it("picks a train on a visible route", () => {
    const hit = pickAt(fakeMap({ x: 100, y: 100 }), vehicle(1, 42), 1, [], { x: 100, y: 100 }, []);
    expect(hit).toEqual({ type: "vehicle", runIdx: 42 });
  });

  it("ignores a train on a hidden route", () => {
    // Clicking where a hidden line's train would be must fall through to the
    // map, not select something the user cannot see.
    const hit = pickAt(fakeMap({ x: 100, y: 100 }), vehicle(1, 42), 1, [], { x: 100, y: 100 }, [1]);
    expect(hit).toBeNull();
  });

  it("ignores a station on a hidden route", () => {
    const stations = [
      { route_idx: 1, station_idx: 0, code: "N1", name_en: "X", name_th: "X",
        arc_m: 0, x: 0, y: 0, z: 15, interchanges: [] },
    ];
    const hit = pickAt(fakeMap({ x: 100, y: 100 }), new Float32Array(0), 0, stations, { x: 100, y: 100 }, [1]);
    expect(hit).toBeNull();
  });
});
