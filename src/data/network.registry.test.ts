import { describe, expect, it } from "vitest";
import { LINES } from "../../tools/lines.config.mjs";
import network from "./network.json";

describe("committed network.json matches the registry", () => {
  it("has the same lines in the same order", () => {
    // This is THE invariant: registry index == network.json lines[i] ==
    // cache routes[i] == vehicle-buffer route_idx. A stale committed
    // network.json (someone edited the registry without re-running
    // data:fetch) silently desyncs route_idx across the whole stack.
    const registryKeys = LINES.map((l) => l.key);
    const dataKeys = (network as { lines: { key: string }[] }).lines.map((l) => l.key);
    expect(dataKeys).toEqual(registryKeys);
  });

  it("agrees with the registry on colour, structure and simulated-ness", () => {
    const data = network as {
      lines: { key: string; color: string; gtfsRouteId: string | null }[];
    };
    for (const [i, line] of LINES.entries()) {
      expect(data.lines[i].color, `${line.key} colour`).toBe(line.color);
      expect(data.lines[i].gtfsRouteId, `${line.key} gtfsRouteId`).toBe(line.gtfsRouteId);
    }
  });
});
