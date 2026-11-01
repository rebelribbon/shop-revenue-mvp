// Regressions for the second round of break-test findings: post-approval edits,
// revised estimates mid-job, blank costs, duplicate customers, visit changes.
import { signTestEstimate as signEstimate } from "../helpers/authorization";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, getJob, type JobInput } from "@/domain/jobs";
import { freezeEstimate } from "@/domain/estimates";
import { loadJobWorkflows, recordJobProgress } from "@/domain/job-workflow";
import { calculateJob } from "@/domain/job-costing";
import {
  createAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
} from "@/domain/appointments";
import { formatPhone } from "@/lib/phone-format";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { meta, seedTenant } from "../helpers/fixtures";

async function shop(label: string) {
  const s = await seedTenant(label);
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(s.businessId, s.owner.actor, fn);
  return { s, run };
}

async function signedJob(label: string) {
  const { s, run } = await shop(label);
  const customer = await run((tx) =>
    createCustomer(tx, meta(), { firstName: label, lastName: "Customer" }),
  );
  const vehicle = await run((tx) =>
    createVehicle(tx, meta(), { customerId: customer.id, make: "Ford" }),
  );
  const base: JobInput = {
    customerId: customer.id,
    vehicleId: vehicle.id,
    title: "Brakes",
    parts: [
      {
        description: "Pads",
        quantity: 1,
        unitCostCents: 5000,
        unitPriceCents: 10000,
      },
    ],
    labor: [
      {
        description: "Install",
        estimatedHoursHundredths: 100,
        actualHoursHundredths: null,
        sellRateCents: 10000,
        costRateCents: 4000,
      },
    ],
  };
  const job = await run((tx) => createJob(tx, base));
  const publish = async (supplementReason = "") => {
    const saved = await run((tx) => getJob(tx, job.id));
    return run((tx) =>
      freezeEstimate(tx, meta(), {
        jobId: job.id,
        expectedJobVersion: saved!.version,
        taxBps: 0,
        supplementReason,
        terms: "",
      }),
    );
  };
  const edit = async (change: Partial<JobInput>) => {
    const saved = await run((tx) => getJob(tx, job.id));
    return run((tx) =>
      createJob(tx, {
        ...base,
        ...change,
        jobId: job.id,
        expectedVersion: saved!.version,
      }),
    );
  };
  const flow = async () =>
    (await run((tx) => loadJobWorkflows(tx, [job.id]))).get(job.id)!;
  const sign = (estimate: { path: string }) =>
    signEstimate(
      estimate.path.split("/").pop()!,
      "Customer",
      ["part-0", "labor-0"],
      meta(),
    );
  const estimate = await publish();
  await sign(estimate);
  return { run, base, job, estimate, publish, edit, flow, sign, s };
}

describe("job changes after the customer approved", () => {
  it("flags price edits, but not actual-hours updates", async () => {
    const f = await signedJob("Flagged");
    expect((await f.flow()).changedSinceEstimate).toBe(false);
    await f.edit({
      labor: [{ ...f.base.labor[0], actualHoursHundredths: 150 }],
    });
    expect((await f.flow()).changedSinceEstimate).toBe(false);
    await f.edit({
      parts: [{ ...f.base.parts[0], unitPriceCents: 15000 }],
    });
    expect((await f.flow()).changedSinceEstimate).toBe(true);
    // Sending the updated estimate clears the flag.
    await f.publish("Price changed");
    expect((await f.flow()).changedSinceEstimate).toBe(false);
  });

  it("keeps work in progress when a revised estimate is approved mid-job", async () => {
    const f = await signedJob("Midjob");
    await f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "not_recorded",
        status: "in_progress",
        note: "",
      }),
    );
    await f.edit({
      parts: [
        ...f.base.parts,
        {
          description: "Rotors",
          quantity: 2,
          unitCostCents: 3000,
          unitPriceCents: 6000,
        },
      ],
    });
    const v2 = await f.publish("Found worn rotors");
    expect((await f.flow()).stage).toBe("awaiting");
    await signEstimate(
      v2.path.split("/").pop()!,
      "Customer",
      ["part-0", "part-1", "labor-0"],
      meta(),
    );
    const after = await f.flow();
    expect(after).toMatchObject({ work: "in_progress", stage: "working" });
    // The owner can finish the job without re-starting it.
    await f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: v2.id,
        expectedStatus: "in_progress",
        status: "completed",
        note: "",
      }),
    );
    expect((await f.flow()).stage).toBe("bill");
  });
});

describe("blank costs", () => {
  it("leave profit unknown instead of counting them as $0", () => {
    const t = calculateJob(
      [{ quantity: 1, unitCostCents: null, unitPriceCents: 10000 }],
      [
        {
          estimatedHoursHundredths: 100,
          actualHoursHundredths: 100,
          sellRateCents: 10000,
          costRateCents: 4000,
        },
      ],
    );
    expect(t).toMatchObject({
      subtotalCents: 20000,
      missingCosts: 1,
      estimatedCostCents: null,
      estimatedGrossProfitCents: null,
      actualGrossProfitCents: null,
      estimatedMarginBps: null,
    });
    expect(
      calculateJob(
        [{ quantity: 1, unitCostCents: 0, unitPriceCents: 10000 }],
        [],
      ),
    ).toMatchObject({ missingCosts: 0, estimatedGrossProfitCents: 10000 });
  });
});

describe("duplicate customers", () => {
  it("points to the existing customer unless the owner confirms a different person", async () => {
    const { run } = await shop("Dupes");
    const first = await run((tx) =>
      createCustomer(tx, meta(), {
        firstName: "Pat",
        lastName: "Lee",
        phoneE164: "+15125557777",
        email: "pat@example.test",
      }),
    );
    for (const match of [
      { phoneE164: "+15125557777" },
      { email: "pat@example.test" },
    ])
      await expect(
        run((tx) =>
          createCustomer(tx, meta(), {
            firstName: "Patricia",
            lastName: "Lee",
            ...match,
          }),
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        details: { duplicate: { id: first.id, name: "Pat Lee" } },
      });
    const second = await run((tx) =>
      createCustomer(tx, meta(), {
        firstName: "Pat",
        lastName: "Lee Jr",
        phoneE164: "+15125557777",
        allowDuplicate: true,
      }),
    );
    expect(second.id).not.toBe(first.id);
    // No contact details: nothing to match on.
    await run((tx) =>
      createCustomer(tx, meta(), { firstName: "Pat", lastName: "Lee" }),
    );
  });
});

describe("visits", () => {
  it("can be moved, marked no-show and put back on the schedule", async () => {
    const { run } = await shop("Visits");
    const customer = await run((tx) =>
      createCustomer(tx, meta(), { firstName: "Vic", lastName: "Visit" }),
    );
    const tomorrow = addLocalDays(
      localDateKey(new Date(), "America/Chicago"),
      1,
    );
    const visit = await run((tx) =>
      createAppointment(tx, meta(), {
        customerId: customer.id,
        localStartsAt: `${tomorrow}T09:00`,
      }),
    );
    const moved = await run((tx) =>
      rescheduleAppointment(tx, meta(), visit.id, `${tomorrow}T14:30`),
    );
    expect(moved.startsAt.getTime() - visit.startsAt.getTime()).toBe(
      5.5 * 3600 * 1000,
    );
    await run((tx) => setAppointmentStatus(tx, meta(), visit.id, "no_show"));
    await expect(
      run((tx) => setAppointmentStatus(tx, meta(), visit.id, "completed")),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      run((tx) =>
        rescheduleAppointment(tx, meta(), visit.id, `${tomorrow}T10:00`),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const undone = await run((tx) =>
      setAppointmentStatus(tx, meta(), visit.id, "scheduled"),
    );
    expect(undone.status).toBe("scheduled");
  });
});

it("formats stored US numbers for people, leaves others alone", () => {
  expect(formatPhone("+15125550100")).toBe("(512) 555-0100");
  expect(formatPhone("+442071838750")).toBe("+442071838750");
  expect(formatPhone(null)).toBe("");
});
