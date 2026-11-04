import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  depositFor,
  jobDeposit,
  saveDepositSettings,
  startDeposit,
} from "@/domain/deposits";
import { freezeEstimate } from "@/domain/estimates";
import { listInvoices, recordInvoicePayment } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

// A $1,200 job the customer approved (not invoiced).
async function approvedJob() {
  const t = await seedTenant("Deposit");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Dee", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Engine work",
      parts: [],
      labor: [
        {
          description: "Labor",
          estimatedHoursHundredths: 1000,
          actualHoursHundredths: null,
          sellRateCents: 12000,
          costRateCents: null,
        },
      ],
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
  await signTestEstimate(e.path.split("/").pop()!, "D", ["labor-0"], meta());
  return { t, run, jobId: job.id };
}

describe("Deposits", () => {
  it("asks for a percentage only on work over the amount, when on", () => {
    const s = { on: true, overCents: 50000, percent: 50 };
    expect(depositFor(s, 120000)).toBe(60000);
    expect(depositFor(s, 49999)).toBeNull();
    expect(depositFor({ ...s, on: false }, 120000)).toBeNull();
    expect(depositFor({ ...s, percent: 25 }, 50001)).toBe(12500);
  });

  it("invoices the approved work and leaves the rest due", async () => {
    const f = await approvedJob();
    expect(await f.run((tx) => jobDeposit(tx, f.jobId))).toBeNull(); // off
    await f.run((tx) =>
      saveDepositSettings(tx, meta(), {
        on: true,
        overCents: 50000,
        percent: 25,
      }),
    );
    const d = await f.run((tx) => jobDeposit(tx, f.jobId));
    expect(d).toMatchObject({ approvedCents: 120000, depositCents: 30000 });

    const r = await f.run((tx) => startDeposit(tx, meta(), f.jobId));
    expect(r.depositCents).toBe(30000);
    const [inv] = await f.run((tx) => listInvoices(tx, r.invoiceId));
    expect(inv.totalCents).toBe(120000);
    expect(inv.invoiceTerms).toMatch(
      /Deposit of \$300\.00 \(25%\) due before work starts/,
    );

    // Checkout takes the deposit as a split payment.
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: r.invoiceId,
        amountCents: 30000,
        method: "cash",
        reference: "",
      }),
    );
    const [after] = await f.run((tx) => listInvoices(tx, r.invoiceId));
    expect(after.balanceCents).toBe(90000);
    // Invoiced now: no second deposit.
    expect(await f.run((tx) => jobDeposit(tx, f.jobId))).toBeNull();
    await expect(
      f.run((tx) => startDeposit(tx, meta(), f.jobId)),
    ).rejects.toThrow(/doesn’t need a deposit/);
  });

  it("only the owner changes deposit settings", async () => {
    const t = await seedTenant("DepositStaff", { withStaff: true });
    await expect(
      withTenant(t.businessId, t.staff!.actor, (tx) =>
        saveDepositSettings(tx, meta(), {
          on: true,
          overCents: 0,
          percent: 50,
        }),
      ),
    ).rejects.toThrow();
  });
});
