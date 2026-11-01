import { describe, expect, it } from "vitest";
import { calculateJob, partLineCents } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
const parts = [{ quantity: 1, unitCostCents: 14000, unitPriceCents: 25000 }];
const labor = [
  {
    estimatedHoursHundredths: 200,
    actualHoursHundredths: 300,
    sellRateCents: 12500,
    costRateCents: 2500,
  },
];
describe("job costing", () => {
  it("prices fractional part quantities without rounding the quantity", () => {
    // 4.5 quarts at $7.99 is $35.955, rounded half-up to $35.96 (not 5 × $7.99).
    expect(partLineCents(4.5, 799)).toBe(3596);
    expect(partLineCents(2.25, 1000)).toBe(2250);
    expect(
      calculateJob(
        [{ quantity: 4.5, unitCostCents: 400, unitPriceCents: 799 }],
        [],
      ),
    ).toMatchObject({ partsPriceCents: 3596, partsCostCents: 1800 });
    expect(() => partLineCents(4.555, 100)).toThrow(/quantity/);
    expect(() => partLineCents(0, 100)).toThrow(/quantity/);
    const base = {
      customerId: "00000000-0000-4000-8000-000000000000",
      title: "Oil",
      labor: [],
    };
    const part = { description: "Oil", unitCostCents: 0, unitPriceCents: 799 };
    expect(
      jobInput.safeParse({ ...base, parts: [{ ...part, quantity: 4.5 }] })
        .success,
    ).toBe(true);
    expect(
      jobInput.safeParse({ ...base, parts: [{ ...part, quantity: 4.555 }] })
        .success,
    ).toBe(false);
  });
  it("keeps quoted labor fixed while actual time changes gross profit", () => {
    expect(calculateJob(parts, labor)).toMatchObject({
      subtotalCents: 50000,
      estimatedCostCents: 19000,
      actualCostCents: 21500,
      estimatedGrossProfitCents: 31000,
      actualGrossProfitCents: 28500,
    });
  });
  it("does not report unrecorded time as zero cost", () => {
    expect(
      calculateJob(parts, [{ ...labor[0], actualHoursHundredths: null }])
        .actualGrossProfitCents,
    ).toBeNull();
  });
  it("rounds fractional hours to cents", () => {
    expect(
      calculateJob(
        [],
        [{ ...labor[0], estimatedHoursHundredths: 125, sellRateCents: 9999 }],
      ).laborPriceCents,
    ).toBe(12499);
  });
  it("reports losses and handles zero revenue", () => {
    expect(
      calculateJob(
        [{ quantity: 1, unitCostCents: 100, unitPriceCents: 0 }],
        [],
      ),
    ).toMatchObject({
      estimatedGrossProfitCents: -100,
      estimatedMarginBps: null,
    });
  });
  it("rejects invalid quantities and unsafe arithmetic", () => {
    expect(() => calculateJob([{ ...parts[0], quantity: -1 }], [])).toThrow();
    expect(() =>
      calculateJob([{ ...parts[0], quantity: Number.MAX_SAFE_INTEGER }], []),
    ).toThrow();
  });
});
