import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VehicleManager } from "./VehicleManager";
import { buildTrainGeometry, consistLengthM, CONSISTS } from "./vehicleModels";

describe("consist specs", () => {
  it("keeps the MVP 3 heavy-rail train at 65 m over 4 cars", () => {
    expect(CONSISTS.heavy.cars).toBe(4);
    expect(consistLengthM(CONSISTS.heavy)).toBeCloseTo(65, 1);
  });

  it("makes the Gold Line APM the shortest consist", () => {
    const lengths = Object.values(CONSISTS).map(consistLengthM);
    expect(consistLengthM(CONSISTS.apm)).toBe(Math.min(...lengths));
  });

  it("makes monorail cars narrower than heavy rail", () => {
    expect(CONSISTS.monorail.widthM).toBeLessThan(CONSISTS.heavy.widthM);
  });

  it("builds one merged geometry with a vertex colour per vertex", () => {
    const geo = buildTrainGeometry(CONSISTS.monorail, 0xff69b4);
    const positions = geo.getAttribute("position").count;
    expect(geo.getAttribute("color").count).toBe(positions);
  });

  it("merges every part — a null merge is the silent failure mode", () => {
    // `mergeGeometries` returns null rather than throwing when its inputs
    // disagree about indexing, which is exactly what happened when extruded
    // shells were introduced alongside boxes.
    for (const spec of Object.values(CONSISTS)) {
      const geo = buildTrainGeometry(spec, 0x1964b7);
      expect(geo).not.toBeNull();
      expect(geo.getAttribute("position").count).toBeGreaterThan(300);
    }
  });

  it("carries the line's livery colour on the train itself", () => {
    // A route is identifiable from its train, not only from the track under
    // it: the waist stripe and nose band are painted in the line colour.
    const accent = new THREE.Color(0x1964b7);
    const geo = buildTrainGeometry(CONSISTS.heavy, 0x1964b7);
    const colors = geo.getAttribute("color");
    let accentVertices = 0;
    for (let i = 0; i < colors.count; i++) {
      if (
        Math.abs(colors.getX(i) - accent.r) < 1e-3 &&
        Math.abs(colors.getY(i) - accent.g) < 1e-3 &&
        Math.abs(colors.getZ(i) - accent.b) < 1e-3
      ) {
        accentVertices++;
      }
    }
    expect(accentVertices).toBeGreaterThan(50);
  });

  it("stays within its own footprint — nothing juts out sideways", () => {
    for (const spec of Object.values(CONSISTS)) {
      const geo = buildTrainGeometry(spec, 0x000000);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      // Half a metre of tolerance for the roof kit and coupling overhangs.
      expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(consistLengthM(spec) + 0.5);
      expect(bb.max.y - bb.min.y).toBeLessThanOrEqual(spec.widthM + 0.5);
      // Sits on the deck, never below it.
      expect(bb.min.z).toBeGreaterThanOrEqual(-0.01);
    }
  });
});

describe("view scaling", () => {
  it("leaves trains at true size when the camera is close", () => {
    const manager = new VehicleManager([{ color: "#1964b7", vehicleType: "heavy" }]);
    manager.setViewScale(500);
    expect(manager.scale).toBe(1);
  });

  it("enlarges them as the camera pulls back, so they stay visible", () => {
    const manager = new VehicleManager([{ color: "#1964b7", vehicleType: "heavy" }]);
    manager.setViewScale(500);
    const near = manager.scale;
    manager.setViewScale(20_000);
    expect(manager.scale).toBeGreaterThan(near);
  });

  it("caps the enlargement so a train never swamps its own line", () => {
    const manager = new VehicleManager([{ color: "#1964b7", vehicleType: "apm" }]);
    manager.setViewScale(10_000_000);
    expect(manager.scale).toBeLessThanOrEqual(9);
  });

  it("scales off the SHORTEST consist, so the smallest fleet is the one guaranteed visible", () => {
    const mixed = new VehicleManager([
      { color: "#1964b7", vehicleType: "heavy" },
      { color: "#a3862a", vehicleType: "apm" },
    ]);
    const apmOnly = new VehicleManager([{ color: "#a3862a", vehicleType: "apm" }]);
    mixed.setViewScale(30_000);
    apmOnly.setViewScale(30_000);
    expect(mixed.scale).toBeCloseTo(apmOnly.scale, 6);
  });
});
