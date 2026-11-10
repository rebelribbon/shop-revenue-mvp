import { describe, expect, it } from "vitest";
import {
  inspectionPoints,
  inspectReady,
  inspectionRecommendations,
  type InspectionResults,
} from "@/app/desktop-demo/inspection-checklist";

const allPassed = (): InspectionResults =>
  Object.fromEntries(
    inspectionPoints.map((point) => [
      point.id,
      {
        result: "good" as const,
        notes: "",
        recommendedWork: "",
      },
    ]),
  );

describe("technician multi-point inspection", () => {
  it("cannot submit until all required inspection points are checked", () => {
    expect(inspectReady({})).toBe(false);
    const inspection = allPassed();
    expect(inspectReady(inspection)).toBe(true);
    delete inspection[inspectionPoints[0].id];
    expect(inspectReady(inspection)).toBe(false);
  });

  it("requires findings and proposed work for a failed inspection point", () => {
    const inspection = allPassed();
    inspection.brakes = {
      result: "bad",
      notes: "",
      recommendedWork: "Replace pads",
    };
    expect(inspectReady(inspection)).toBe(false);
    inspection.brakes.notes = "Pads measured at 2 mm";
    expect(inspectReady(inspection)).toBe(true);
    inspection.brakes.recommendedWork = "";
    expect(inspectReady(inspection)).toBe(false);
  });

  it("allows borderline with findings but without a recommended job", () => {
    const inspection=allPassed();
    inspection.tires={result:"borderline",notes:"Tread at 4mm, monitor",recommendedWork:""};
    expect(inspectReady(inspection)).toBe(true);
    expect(inspectionRecommendations(inspection)).toEqual([]);
    inspection.tires.notes="";
    expect(inspectReady(inspection)).toBe(false);
  });
  it("prepopulates only recommended borderline/bad work in the advisor estimate", () => {
    const inspection = allPassed();
    inspection.brakes = {
      result: "attention",
      notes: "Measured 2 mm",
      recommendedWork: "Replace front pads",
    };
    inspection.filters = {
      result: "na",
      notes: "",
      recommendedWork: "",
    };
    expect(inspectionRecommendations(inspection)).toEqual([
      {
        id: "brakes",
        inspectionArea: "Brake pads, rotors and hydraulic system",
        name: "Replace front pads",
        notes: "Measured 2 mm",
      },
    ]);
  });
});
