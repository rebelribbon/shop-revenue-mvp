import { describe, expect, it } from "vitest";
import { timeEntry } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob } from "@/domain/jobs";
import {
  jobProfit,
  myClock,
  setTargetMargin,
  startClock,
  stopClock,
} from "@/domain/job-profit";
import { meta, seedTenant } from "../helpers/fixtures";

async function fixture(partCost: number | null = 4000) {
  const t = await seedTenant("Profit");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Profit", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const j = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      // $100 part costing $40, 2 hours sold at $120/h costing $30/h.
      parts: [
        {
          description: "Pads",
          quantity: 1,
          unitPriceCents: 10000,
          unitCostCents: partCost,
        },
      ],
      labor: [
        {
          description: "Labor",
          estimatedHoursHundredths: 200,
          actualHoursHundredths: null,
          sellRateCents: 12000,
          costRateCents: 3000,
        },
      ],
    }),
  );
  return { t, run, jobId: j.id };
}

describe("Profit on every job", () => {
  it("shows profit from quoted hours, and flags it below the target", async () => {
    const f = await fixture();
    const p = (await f.run((tx) => jobProfit(tx, f.jobId)))!;
    // Sales $340; costs $40 parts + $60 labor = $100; profit $240 (71%).
    expect(p).toMatchObject({
      salesCents: 34000,
      costCents: 10000,
      profitCents: 24000,
      marginBps: 7059,
      laborBasis: "quoted",
      belowTarget: false,
    });
    await f.run((tx) => setTargetMargin(tx, meta(), 80));
    expect((await f.run((tx) => jobProfit(tx, f.jobId)))!.belowTarget).toBe(
      true,
    );
  });

  it("won't guess profit when a part cost is missing", async () => {
    const f = await fixture(null);
    const p = (await f.run((tx) => jobProfit(tx, f.jobId)))!;
    expect(p.profitCents).toBeNull();
    expect(p.missing).toContain("a part has no cost");
  });

  it("uses clocked time for labor cost, one running clock per person", async () => {
    const f = await fixture();
    // A finished 3-hour shift on this job.
    await f.run((tx) =>
      tx.insert(timeEntry).values({
        businessId: f.t.businessId,
        jobId: f.jobId,
        userId: f.t.owner.actor.id!,
        startedAt: new Date(Date.now() - 3 * 3600 * 1000),
        endedAt: new Date(),
      }),
    );
    // Clock on and off again: one running clock, stopped cleanly.
    await f.run((tx) => startClock(tx, meta(), f.jobId));
    expect((await f.run((tx) => myClock(tx)))?.jobId).toBe(f.jobId);
    await f.run((tx) => stopClock(tx, meta()));
    const p = (await f.run((tx) => jobProfit(tx, f.jobId)))!;
    expect(p.laborBasis).toBe("clocked");
    expect(p.clockedMinutes).toBeGreaterThanOrEqual(179);
    // 3h × $30 = $90 labor cost → profit $340 − $40 − $90 = $210.
    expect(p.profitCents).toBe(21000);
    expect(await f.run((tx) => myClock(tx))).toBeNull();
    await expect(f.run((tx) => stopClock(tx, meta()))).rejects.toThrow(
      /isn’t running/,
    );
  });
});
