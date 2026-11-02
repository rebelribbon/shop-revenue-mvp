import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createAppointment } from "@/domain/appointments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { listCustomerJobs } from "@/domain/customer-profile";
import { freezeEstimate } from "@/domain/estimates";
import { createJob, getJob } from "@/domain/jobs";
import { jobFilter, jobStatus, jobStatusLabels } from "@/lib/job-status";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

it("maps each workflow stage to one plain status, worded for the trade", () => {
  const past = { estimate: { expiresAt: new Date(0) } };
  const future = { estimate: { expiresAt: new Date(Date.now() + 1e9) } };
  expect(jobStatus({ stage: "awaiting", latest: future })).toBe("sent");
  expect(jobStatus({ stage: "awaiting", latest: past })).toBe("expired");
  expect(jobStatus({ stage: "ready", latest: future })).toBe("won");
  expect(
    jobStatus({ stage: "ready", latest: future, nextVisit: new Date() }),
  ).toBe("scheduled");
  expect(jobStatus({ stage: "declined", latest: future })).toBe("lost");
  expect(jobStatus({ stage: "payment", latest: future })).toBe("invoiced");
  expect(jobStatus({ stage: "plan", latest: future })).toBe("recurring");
  expect(jobStatusLabels("automotive").sent).toBe("Estimate sent");
  expect(jobStatusLabels("landscaping").sent).toBe("Bid sent");
  expect(jobStatusLabels("handyman").won).toBe("Won");
  expect(jobFilter("lost").statuses).toEqual(["lost", "expired"]);
  expect(jobFilter("nonsense").key).toBe("all");
});

it("a won job becomes Scheduled once a visit is booked for that vehicle or property", async () => {
  const t = await seedTenant("Job status");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Status", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      parts: [
        {
          description: "Pads",
          quantity: 1,
          unitCostCents: 1,
          unitPriceCents: 5000,
        },
      ],
      labor: [],
    }),
  );
  const status = async () =>
    (await run((tx) => listCustomerJobs(tx, c.id)))[0].status;
  expect(await status()).toBe("draft");
  const saved = await run((tx) => getJob(tx, job.id));
  const e = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: job.id,
      expectedJobVersion: saved!.version,
      taxBps: 0,
      supplementReason: "",
      terms: "",
    }),
  );
  expect(await status()).toBe("sent");
  await signTestEstimate(e.path.split("/").pop()!, "S", ["part-0"], meta());
  expect(await status()).toBe("won");
  const tomorrow = addLocalDays(localDateKey(new Date(), "America/Chicago"), 1);
  await run((tx) =>
    createAppointment(tx, meta(), {
      customerId: c.id,
      vehicleId: v.id,
      localStartsAt: `${tomorrow}T09:00`,
    }),
  );
  expect(await status()).toBe("scheduled");
});
