import { describe, expect, it } from "vitest";
import { automaticEstimateChanges } from "@/lib/estimate-changes";
import type { EstimateSnapshot } from "@/db/schema/m3";

const original: EstimateSnapshot = {
  title: "Brake service",
  shopName: "Example Auto",
  customerName: "Test Customer",
  vehicleLabel: "2018 Sedan",
  lines: [
    {
      id: "labor-0",
      description: "Front brake repair",
      kind: "labor",
      quantity: 1,
      unitPriceCents: 12000,
      totalCents: 12000,
    },
  ],
  subtotalCents: 12000,
  taxBps: 0,
  taxCents: 0,
  totalCents: 12000,
  terms: "",
};

describe("automatic customer estimate revision history", () => {
  it("never requires a revision note on the first estimate", () => {
    expect(automaticEstimateChanges(null, original)).toBeNull();
  });
  it("records which labor price changed and the total without typing", () => {
    const updated: EstimateSnapshot = {
      ...original,
      lines: [{ ...original.lines[0], unitPriceCents: 15000, totalCents: 15000 }],
      subtotalCents: 15000,
      totalCents: 15000,
    };
    const changes = automaticEstimateChanges(original, updated);
    expect(changes).toContain("Front brake repair");
    expect(changes).toContain("$120.00");
    expect(changes).toContain("$150.00");
    expect(changes).toContain("Estimate total");
  });
  it("records new parts with the original labor untouched", () => {
    const updated: EstimateSnapshot = {
      ...original,
      lines: [
        ...original.lines,
        {
          id: "part-0",
          description: "Front brake pads",
          kind: "part",
          quantity: 1,
          unitPriceCents: 9800,
          totalCents: 9800,
        },
      ],
      subtotalCents: 21800,
      totalCents: 21800,
    };
    expect(automaticEstimateChanges(original, updated)).toContain(
      "Added part: Front brake pads",
    );
  });
  it("records a reissue without inventing price changes", () => {
    expect(automaticEstimateChanges(original, { ...original })).toContain(
      "no changes to priced work",
    );
  });
});
