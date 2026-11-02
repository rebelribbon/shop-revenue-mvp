import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice, recordInvoicePayment } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import { presetRange, reportCsv, runReport } from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

it("picks calendar ranges", () => {
  expect(presetRange("month", "2026-11-02")).toEqual({
    from: "2026-11-01",
    to: "2026-11-30",
  });
  expect(presetRange("last-month", "2026-01-15")).toEqual({
    from: "2025-12-01",
    to: "2025-12-31",
  });
  expect(presetRange("quarter", "2026-11-02")).toEqual({
    from: "2026-10-01",
    to: "2026-12-31",
  });
  expect(presetRange("last-quarter", "2026-02-02")).toEqual({
    from: "2025-10-01",
    to: "2025-12-31",
  });
  expect(presetRange("last-year", "2026-05-05").from).toBe("2025-01-01");
});

it("sales, tax, profit, payments and customers agree with the invoices", async () => {
  const t = await seedTenant("Reports", { withStaff: true });
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "=Report", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: 'Brakes, "front"',
      parts: [
        {
          description: "Pads",
          quantity: 1,
          unitCostCents: 4000,
          unitPriceCents: 10000,
          taxable: true,
        },
      ],
      labor: [
        {
          description: "Install",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          sellRateCents: 5000,
          costRateCents: 2000,
          taxable: false,
        },
      ],
    }),
  );
  const saved = await run((tx) => getJob(tx, job.id));
  const e = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: job.id,
      expectedJobVersion: saved!.version,
      taxBps: 1000,
      supplementReason: "",
      terms: "",
    }),
  );
  await signTestEstimate(
    e.path.split("/").pop()!,
    "R",
    ["part-0", "labor-0"],
    meta(),
  );
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  await run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: inv.id,
      amountCents: 6000,
      method: "cash",
      reference: "",
    }),
  );
  const today = localDateKey(new Date(), "America/Chicago");
  const range = { from: today, to: today };
  const sales = await run((tx) => runReport(tx, "sales", range));
  // $150 before tax, $10 tax on the $100 taxable part, $160 total, $60 paid.
  expect(sales.totals!.slice(4)).toEqual([15000, 1000, 16000, 6000, 10000]);
  const tax = await run((tx) => runReport(tx, "tax", range));
  expect(tax.rows[0].slice(1)).toEqual([10000, 5000, 1000, 16000]);
  const profit = await run((tx) => runReport(tx, "profit", range));
  // Cost $40 part + $20 labor = $60, kept $90 (60%).
  expect(profit.rows[0].slice(4)).toEqual([15000, 6000, 9000, "60%"]);
  const payments = await run((tx) => runReport(tx, "payments", range));
  expect(payments.totals![5]).toBe(6000);
  const customers = await run((tx) => runReport(tx, "customers", range));
  expect(customers.rows[0]).toEqual(["=Report TEST", 1, 6000]);
  // CSV: dollars, quoted commas/quotes, and spreadsheet formulas neutralized.
  const csv = reportCsv(sales);
  expect(csv).toContain('"Brakes, ""front"""');
  expect(csv).toContain(`"'=Report TEST"`);
  expect(csv).toContain(",150.00,10.00,160.00,60.00,100.00");
  await expect(
    withTenant(t.businessId, t.staff!.actor, (tx) =>
      runReport(tx, "sales", range),
    ),
  ).rejects.toThrow();
});
