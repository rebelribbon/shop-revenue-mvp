import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { recordJobProgress } from "@/domain/job-workflow";
import { createJob, getJob } from "@/domain/jobs";
import { todayAgenda } from "@/domain/today";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

it("lists what needs the owner: bids with no answer, work to bill, jobs to schedule", async () => {
  const t = await seedTenant("Today");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Agenda", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const make = async (title: string) => {
    const job = await run((tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title,
        parts: [
          {
            description: "Part",
            quantity: 1,
            unitCostCents: 1,
            unitPriceCents: 5000,
          },
        ],
        labor: [],
      }),
    );
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
    return { job, e };
  };
  const waiting = await make("Waiting bid");
  const won = await make("Won job");
  await signTestEstimate(won.e.path.split("/").pop()!, "A", ["part-0"], meta());
  const done = await make("Finished job");
  await signTestEstimate(
    done.e.path.split("/").pop()!,
    "A",
    ["part-0"],
    meta(),
  );
  for (const status of ["in_progress", "completed"] as const)
    await run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: done.job.id,
        versionId: done.e.id,
        expectedStatus:
          status === "in_progress" ? "not_recorded" : "in_progress",
        status,
        note: "",
      }),
    );
  // Three days from now the waiting bid has gone unanswered.
  const later = new Date(Date.now() + 3 * 86400000);
  const { items } = await run((tx) => todayAgenda(tx, later));
  const kinds = Object.fromEntries(items.map((i) => [i.title, i.kind]));
  expect(kinds).toMatchObject({
    "Agenda TEST hasn’t answered: Waiting bid": "bid",
    "Won, not scheduled: Won job": "schedule",
    "Finished, not billed: Finished job": "unbilled",
  });
  expect(items[0].kind).toBe("unbilled");
  void waiting;
});
