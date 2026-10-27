import { describe, expect, it } from "vitest";
import { calculateJob } from "@/domain/job-costing";
const parts = [{ quantity: 1, unitCostCents: 14000, unitPriceCents: 25000 }];
const labor = [{ estimatedHoursHundredths: 200, actualHoursHundredths: 300, sellRateCents: 12500, costRateCents: 2500 }];
describe("job costing", () => {
  it("keeps quoted labor fixed while actual time changes gross profit", () => {
    expect(calculateJob(parts, labor)).toMatchObject({ subtotalCents: 50000, estimatedCostCents: 19000, actualCostCents: 21500, estimatedGrossProfitCents: 31000, actualGrossProfitCents: 28500 });
  });
  it("does not report unrecorded time as zero cost", () => {
    expect(calculateJob(parts, [{ ...labor[0], actualHoursHundredths: null }]).actualGrossProfitCents).toBeNull();
  });
  it("rounds fractional hours to cents", () => {
    expect(calculateJob([], [{ ...labor[0], estimatedHoursHundredths: 125, sellRateCents: 9999 }]).laborPriceCents).toBe(12499);
  });
  it("reports losses and handles zero revenue", () => {
    expect(calculateJob([{ quantity: 1, unitCostCents: 100, unitPriceCents: 0 }], [])).toMatchObject({ estimatedGrossProfitCents: -100, estimatedMarginBps: null });
  });
  it("rejects invalid quantities and unsafe arithmetic", () => {
    expect(() => calculateJob([{ ...parts[0], quantity: -1 }], [])).toThrow();
    expect(() => calculateJob([{ ...parts[0], quantity: Number.MAX_SAFE_INTEGER }], [])).toThrow();
  });
});

