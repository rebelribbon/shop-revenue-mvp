import { it, expect } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, listJobs } from "@/domain/jobs";
import { seedTenant, meta } from "../helpers/fixtures";
it("saves an internal job sheet and isolates it from another shop", async () => {
  const a = await seedTenant("Costing"),
    b = await seedTenant("Other costing");
  const c = await withTenant(a.businessId, a.owner.actor, (tx) =>
    createCustomer(tx, meta(), { firstName: "Job", lastName: "Customer" }),
  );
  const v = await withTenant(a.businessId, a.owner.actor, (tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Honda" }),
  );
  const input = {
    customerId: c.id,
    vehicleId: v.id,
    title: "Brakes",
    parts: [
      {
        description: "Pads",
        quantity: 1,
        unitCostCents: 10000,
        unitPriceCents: 20000,
      },
    ],
    labor: [
      {
        description: "Install",
        estimatedHoursHundredths: 200,
        actualHoursHundredths: null,
        sellRateCents: 12500,
        costRateCents: 3000,
      },
    ],
  };
  await withTenant(a.businessId, a.owner.actor, (tx) => createJob(tx, input));
  const jobs = await withTenant(a.businessId, a.owner.actor, (tx) =>
    listJobs(tx),
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].data).toMatchObject({
    totals: { subtotalCents: 45000, actualGrossProfitCents: null },
  });
  expect(
    await withTenant(b.businessId, b.owner.actor, (tx) => listJobs(tx)),
  ).toEqual([]);
  await expect(
    withTenant(b.businessId, b.owner.actor, (tx) => createJob(tx, input)),
  ).rejects.toThrow();
});
