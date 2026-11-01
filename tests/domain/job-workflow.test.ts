import { signTestEstimate as signEstimate } from "../helpers/authorization";
import { sql } from "drizzle-orm";
import { stripeConnection } from "@/db/schema";
import { reserveCheckout, withPaymentTenant } from "@/domain/payments";
import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, getJob, listJobs } from "@/domain/jobs";
import { freezeEstimate } from "@/domain/estimates";
import {
  issueInvoice,
  recordInvoicePayment,
  reverseInvoicePayment,
  rotateInvoiceLink,
  setInvoiceDispute,
} from "@/domain/invoices";
import {
  loadJobWorkflows,
  recordJobProgress,
  recordJobSharing,
} from "@/domain/job-workflow";
import { meta, seedTenant } from "../helpers/fixtures";
import { formatDateOnly, localDateKey } from "@/lib/timezone";

async function fixture(label: string) {
  const shop = await seedTenant(label);
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(shop.businessId, shop.owner.actor, fn);
  const customer = await run((tx) =>
    createCustomer(tx, meta(), { firstName: label, lastName: "Customer" }),
  );
  const vehicle = await run((tx) =>
    createVehicle(tx, meta(), { customerId: customer.id, make: "Honda" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      title: "Brake repair",
      parts: [
        {
          description: "Brake pads",
          quantity: 1,
          unitCostCents: 1000,
          unitPriceCents: 2000,
        },
      ],
      labor: [
        {
          description: "Optional alignment",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          costRateCents: 1000,
          sellRateCents: 5000,
        },
      ],
    }),
  );
  const saved = await run((tx) => getJob(tx, job.id));
  const estimate = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: job.id,
      expectedJobVersion: saved!.version,
      taxBps: 0,
      supplementReason: "",
      terms: "",
    }),
  );
  const flow = async () =>
    (await run((tx) => loadJobWorkflows(tx, [job.id]))).get(job.id)!;
  return { shop, run, job, customer, vehicle, estimate, saved: saved!, flow };
}

it("keeps authorization, actual work and payment independent through early billing, payment and reversal", async () => {
  const f = await fixture("Workflow");
  expect(await f.flow()).toMatchObject({
    approval: "Awaiting customer",
    work: "not_recorded",
    stage: "awaiting",
    paidCents: 0,
  });
  await expect(
    f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "not_recorded",
        status: "in_progress",
        note: "",
      }),
    ),
  ).rejects.toThrow(/authorization/);
  await signEstimate(
    f.estimate.path.split("/").pop()!,
    "Customer",
    ["part-0"],
    meta(),
  );
  const authorized = await f.flow();
  expect(authorized.approval).toBe("Partially authorized");
  expect(authorized.approved.map((l) => l.description)).toEqual(["Brake pads"]);
  expect(authorized.declined.map((l) => l.description)).toEqual([
    "Optional alignment",
  ]);
  const invoice = await f.run((tx) =>
    issueInvoice(tx, meta(), {
      versionId: f.estimate.id,
      dueOn: null,
      terms: "",
    }),
  );
  await f.run((tx) =>
    recordJobSharing(tx, meta(), {
      jobId: f.job.id,
      documentId: invoice.id,
      kind: "invoice",
    }),
  );
  expect(await f.flow()).toMatchObject({
    work: "not_recorded",
    stage: "ready",
    paidCents: 0,
    balanceCents: 2000,
    sharedInvoice: true,
  });
  await f.run((tx) => rotateInvoiceLink(tx, meta(), invoice.id));
  expect((await f.flow()).sharedInvoice).toBe(false);
  const payment = await f.run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: invoice.id,
      amountCents: 2000,
      method: "cash",
      reference: "Receipt",
    }),
  );
  expect(await f.flow()).toMatchObject({
    work: "not_recorded",
    stage: "ready",
    paidCents: 2000,
    balanceCents: 0,
  });
  const starts = await Promise.allSettled(
    [1, 2].map(() =>
      f.run((tx) =>
        recordJobProgress(tx, meta(), {
          jobId: f.job.id,
          versionId: f.estimate.id,
          expectedStatus: "not_recorded",
          status: "in_progress",
          note: "",
        }),
      ),
    ),
  );
  expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "not_recorded",
        status: "completed",
        note: "",
      }),
    ),
  ).rejects.toThrow(/changed/);
  await f.run((tx) =>
    recordJobProgress(tx, meta(), {
      jobId: f.job.id,
      versionId: f.estimate.id,
      expectedStatus: "in_progress",
      status: "completed",
      note: "",
    }),
  );
  expect(await f.flow()).toMatchObject({
    work: "completed",
    stage: "paid",
    paidCents: 2000,
  });
  await f.run((tx) =>
    setInvoiceDispute(tx, meta(), invoice.id, "Customer reported a concern"),
  );
  expect((await f.flow()).stage).toBe("attention");
  await f.run((tx) => setInvoiceDispute(tx, meta(), invoice.id, null));
  await f.run((tx) =>
    reverseInvoicePayment(tx, meta(), payment.id, "Cash entry correction"),
  );
  const adjusted = await f.flow();
  expect(adjusted).toMatchObject({
    work: "completed",
    stage: "payment",
    paidCents: 0,
    balanceCents: 2000,
  });
  for (const fact of [
    "Customer decision",
    "Invoice #",
    "Payment recorded",
    "Work started",
    "Work completed",
    "Payment adjustment",
  ])
    expect(adjusted.timeline.some((e) => e.text.includes(fact))).toBe(true);
  await expect(
    f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "completed",
        status: "in_progress",
        note: "",
      }),
    ),
  ).rejects.toThrow(/Explain/);
  await f.run((tx) =>
    recordJobProgress(tx, meta(), {
      jobId: f.job.id,
      versionId: f.estimate.id,
      expectedStatus: "completed",
      status: "in_progress",
      note: "Final road test still needed",
    }),
  );
  expect((await f.flow()).work).toBe("in_progress");
  const other = await seedTenant("Other workflow");
  expect(
    await withTenant(other.businessId, other.owner.actor, (tx) =>
      getJob(tx, f.job.id),
    ),
  ).toBeNull();
  const hidden = (
    await withTenant(other.businessId, other.owner.actor, (tx) =>
      loadJobWorkflows(tx, [f.job.id]),
    )
  ).get(f.job.id)!;
  expect(hidden.latest).toBeNull();
  expect(hidden.timeline).toEqual([]);
  expect(hidden.entries).toEqual([]);
  await expect(
    withTenant(other.businessId, other.owner.actor, (tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "in_progress",
        status: "completed",
        note: "",
      }),
    ),
  ).rejects.toThrow();
  await expect(
    withTenant(
      f.shop.businessId,
      { type: "support", id: null },
      (tx) =>
        recordJobProgress(tx, meta(), {
          jobId: f.job.id,
          versionId: f.estimate.id,
          expectedStatus: "in_progress",
          status: "completed",
          note: "",
        }),
      { supportAudit: true },
    ),
  ).rejects.toThrow();
});

it("requires a new signature for a supplement and never treats declined work as ready", async () => {
  const f = await fixture("Supplement workflow");
  await signEstimate(
    f.estimate.path.split("/").pop()!,
    "Customer",
    ["part-0"],
    meta(),
  );
  await f.run((tx) =>
    recordJobProgress(tx, meta(), {
      jobId: f.job.id,
      versionId: f.estimate.id,
      expectedStatus: "not_recorded",
      status: "in_progress",
      note: "",
    }),
  );
  const revised = await f.run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: f.job.id,
      expectedJobVersion: f.saved.version,
      taxBps: 0,
      supplementReason: "Updated scope",
      terms: "",
    }),
  );
  expect(await f.flow()).toMatchObject({
    work: "not_recorded",
    stage: "awaiting",
    approval: "Awaiting customer",
  });
  await expect(
    f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "in_progress",
        status: "completed",
        note: "",
      }),
    ),
  ).rejects.toThrow(/authorization/);
  await signEstimate(revised.path.split("/").pop()!, "Customer", [], meta());
  expect(await f.flow()).toMatchObject({ stage: "declined", approved: [] });
  await expect(
    f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: revised.id,
        expectedStatus: "not_recorded",
        status: "in_progress",
        note: "",
      }),
    ),
  ).rejects.toThrow(/authorization/);
  expect(
    (await f.flow()).timeline.some((e) => e.text.includes("Work started")),
  ).toBe(true);
});

it("opens a stable job directly even after it leaves the recent-100 list", async () => {
  const f = await fixture("Older workflow");
  for (let n = 0; n < 101; n++)
    await f.run((tx) =>
      createJob(tx, {
        customerId: f.customer.id,
        vehicleId: f.vehicle.id,
        title: `Recent ${n}`,
        parts: [],
        labor: [],
      }),
    );
  expect(
    (await f.run((tx) => listJobs(tx))).some((j) => j.id === f.job.id),
  ).toBe(false);
  expect((await f.run((tx) => getJob(tx, f.job.id)))?.id).toBe(f.job.id);
  expect(
    (await f.run((tx) => listJobs(tx, "Brake repair"))).some(
      (j) => j.id === f.job.id,
    ),
  ).toBe(true);
  expect(await f.run((tx) => getJob(tx, "not-a-job"))).toBeNull();
});

it("keeps calendar due dates stable at a shop timezone boundary", () => {
  expect(
    localDateKey(new Date("2026-11-01T00:30:00Z"), "America/Chicago"),
  ).toBe("2026-10-31");
  expect(formatDateOnly("2026-11-01")).toBe("Nov 1, 2026");
  expect(formatDateOnly("2028-02-29")).toBe("Feb 29, 2028");
});

it("does not count an open online checkout as collected money", async () => {
  const f = await fixture("Pending checkout workflow");
  await signEstimate(
    f.estimate.path.split("/").pop()!,
    "Customer",
    ["part-0"],
    meta(),
  );
  const issued = await f.run((tx) =>
    issueInvoice(tx, meta(), {
      versionId: f.estimate.id,
      dueOn: null,
      terms: "",
    }),
  );
  await f.run((tx) =>
    tx.insert(stripeConnection).values({
      businessId: f.shop.businessId,
      accountId: `acct_${crypto.randomUUID()}`,
      cardPaymentsStatus: "active",
      livemode: false,
    }),
  );
  await withPaymentTenant(f.shop.businessId, (tx) =>
    reserveCheckout(tx, issued.id),
  );
  expect(await f.flow()).toMatchObject({
    processing: true,
    paidCents: 0,
    balanceCents: 2000,
    work: "not_recorded",
  });
});

it("orders work transitions by their locked write, even when a transaction began earlier", async () => {
  const f = await fixture("Work ordering");
  await signEstimate(
    f.estimate.path.split("/").pop()!,
    "Customer",
    ["part-0"],
    meta(),
  );
  let ready!: () => void;
  let proceed!: () => void;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const completion = f.run(async (tx) => {
    await tx.execute(sql`select 1`);
    ready();
    await resume;
    return recordJobProgress(tx, meta(), {
      jobId: f.job.id,
      versionId: f.estimate.id,
      expectedStatus: "in_progress",
      status: "completed",
      note: "",
    });
  });
  await waiting;
  try {
    await f.run((tx) =>
      recordJobProgress(tx, meta(), {
        jobId: f.job.id,
        versionId: f.estimate.id,
        expectedStatus: "not_recorded",
        status: "in_progress",
        note: "",
      }),
    );
  } finally {
    proceed();
  }
  await completion;
  expect((await f.flow()).work).toBe("completed");
});
