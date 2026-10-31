import { it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { expense, invoicePayment, estimateVersion } from "@/db/schema";
import {
  addExpense,
  reverseExpense,
  getOwnerMoney,
} from "@/domain/owner-money";
import {
  saveCommonJob,
  listCommonJobs,
  archiveCommonJob,
} from "@/domain/common-jobs";
import { getDocumentShare } from "@/domain/document-sharing";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, listJobs } from "@/domain/jobs";
import {
  freezeEstimate,
  readPublicEstimate,
  rotateEstimateLink,
} from "@/domain/estimates";
import {
  issueInvoice,
  recordInvoicePayment,
  reverseInvoicePayment,
} from "@/domain/invoices";
import { createAppointment, listVisitsRange } from "@/domain/appointments";
import { exportPage } from "@/domain/data-export";
import { updateBusinessProfile } from "@/domain/business-profile";
import { openShareToken, sealShareToken } from "@/lib/share-token";
import { localDateKey } from "@/lib/timezone";
import { meta, seedTenant } from "../helpers/fixtures";
import { signTestEstimate } from "../helpers/authorization";
async function fixture(label: string) {
  const t = await seedTenant(label, { withStaff: true });
  const run = <T>(f: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, f);
  const c = await run((tx) =>
    createCustomer(tx, meta(), {
      firstName: "Maria",
      lastName: "Shop",
      phoneE164: "+12105550100",
      email: "maria@example.test",
    }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Honda" }),
  );
  return { t, run, c, v };
}
const parts = [
  {
    description: "Brake pads",
    quantity: 1,
    unitCostCents: 10000,
    unitPriceCents: 20000,
    taxable: true,
  },
];
const labor = [
  {
    description: "Install pads",
    estimatedHoursHundredths: 100,
    actualHoursHundredths: null,
    sellRateCents: 10000,
    costRateCents: 5000,
    taxable: false,
  },
];
it("records expenses once, corrects with immutable exact reversals, and isolates owner writes", async () => {
  const f = await fixture("Expenses"),
    other = await fixture("Other expenses");
  const input = {
    spentOn: "2026-10-31",
    description: "Rent",
    category: "rent" as const,
    amountCents: 50000,
    includedInJobCost: false,
  };
  const e = await f.run((tx) => addExpense(tx, meta(), input));
  await expect(
    withTenant(f.t.businessId, f.t.staff!.actor, (tx) =>
      addExpense(tx, meta(), input),
    ),
  ).rejects.toThrow(/owner/);
  await expect(
    withTenant(f.t.businessId, { type: "support", id: null }, (tx) =>
      addExpense(tx, meta(), input),
    ),
  ).rejects.toThrow();
  expect(
    await other.run((tx) =>
      tx.select().from(expense).where(eq(expense.id, e.id)),
    ),
  ).toEqual([]);
  await expect(
    other.run((tx) => reverseExpense(tx, meta(), e.id, "Other shop")),
  ).rejects.toThrow();
  const corrected = await f.run((tx) =>
    reverseExpense(tx, meta(), e.id, "Wrong amount"),
  );
  expect(corrected.id).toBeTruthy();
  await expect(
    f.run((tx) => reverseExpense(tx, meta(), e.id, "Again")),
  ).rejects.toThrow();
  const m = await f.run((tx) => getOwnerMoney(tx, "2026-10"));
  expect(m.expenseCents).toBe(0);
  expect(m.expenses.find((x) => x.id === e.id)?.corrected).toBe(true);
  await expect(
    f.run((tx) =>
      tx.update(expense).set({ amountCents: 1 }).where(eq(expense.id, e.id)),
    ),
  ).rejects.toThrow();
  await expect(
    f.run((tx) => tx.delete(expense).where(eq(expense.id, e.id))),
  ).rejects.toThrow();
  expect(
    (await f.run((tx) => exportPage(tx, "expenses", new Date()))).length,
  ).toBe(2);
});
it("reuses share links, encrypts tokens, verifies rotation, and never exposes cached secrets publicly", async () => {
  const f = await fixture("Stable sharing");
  const j = await f.run((tx) =>
    createJob(tx, {
      customerId: f.c.id,
      vehicleId: f.v.id,
      title: "Brake repair",
      parts,
      labor,
    }),
  );
  const [saved] = await f.run((tx) => listJobs(tx));
  const e = await f.run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: j.id,
      expectedJobVersion: saved.version,
      taxBps: 825,
      terms: "",
      supplementReason: "",
    }),
  );
  const first = await f.run((tx) => getDocumentShare(tx, e.id, "estimate")),
    again = await f.run((tx) => getDocumentShare(tx, e.id, "estimate"));
  expect(first.path).toBe(e.path);
  expect(again.path).toBe(first.path);
  expect(first.phone).toBe(f.c.phoneE164);
  expect(first.email).toBe(f.c.email);
  const [row] = await f.run((tx) =>
    tx.select().from(estimateVersion).where(eq(estimateVersion.id, e.id)),
  );
  const token = e.path.split("/").pop()!;
  expect(row.shareTokenCiphertext).not.toContain(token);
  expect(openShareToken(row.shareTokenCiphertext!)).toBe(token);
  expect(JSON.stringify(await readPublicEstimate(token))).not.toMatch(
    /shareTokenCiphertext|v1\./,
  );
  const changed = await f.run((tx) => rotateEstimateLink(tx, meta(), e.id));
  expect(
    (await f.run((tx) => getDocumentShare(tx, e.id, "estimate"))).path,
  ).toBe(changed.path);
  expect(await readPublicEstimate(token)).toBeNull();
  await expect(
    withTenant(f.t.businessId, { type: "support", id: null }, (tx) =>
      getDocumentShare(tx, e.id, "estimate"),
    ),
  ).rejects.toThrow();
  const other = await fixture("Other share");
  await expect(
    other.run((tx) => getDocumentShare(tx, e.id, "estimate")),
  ).rejects.toThrow();
  expect(openShareToken(sealShareToken("private-test-token"))).toBe(
    "private-test-token",
  );
  expect(
    JSON.stringify(
      await f.run((tx) => exportPage(tx, "estimates", new Date())),
    ),
  ).not.toContain("shareTokenCiphertext");
});
it("shows sales, net collections, all unpaid money, quote-based profit and expenses without double counting job costs", async () => {
  const f = await fixture("Money totals");
  const j = await f.run((tx) =>
    createJob(tx, {
      customerId: f.c.id,
      vehicleId: f.v.id,
      title: "Brake repair",
      parts,
      labor,
    }),
  );
  const [saved] = await f.run((tx) => listJobs(tx));
  const e = await f.run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: j.id,
      expectedJobVersion: saved.version,
      taxBps: 825,
      terms: "",
      supplementReason: "",
    }),
  );
  await signTestEstimate(
    e.path.split("/").pop()!,
    "Maria",
    ["part-0", "labor-0"],
    meta(),
  );
  const issued = await f.run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  expect(
    (await f.run((tx) => getDocumentShare(tx, issued.id, "invoice"))).path,
  ).toBe(issued.path);
  await f.run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: issued.id,
      amountCents: 10000,
      method: "cash",
      reference: "",
    }),
  );
  const month = localDateKey(new Date(), "America/Chicago").slice(0, 7),
    spentOn = month + "-01";
  await f.run((tx) =>
    addExpense(tx, meta(), {
      spentOn,
      description: "Rent",
      category: "rent",
      amountCents: 5000,
      includedInJobCost: false,
    }),
  );
  await f.run((tx) =>
    addExpense(tx, meta(), {
      spentOn,
      description: "Pads purchase",
      category: "parts",
      amountCents: 10000,
      includedInJobCost: true,
    }),
  );
  const m = await f.run((tx) => getOwnerMoney(tx, month));
  expect(m).toMatchObject({
    salesCents: 30000,
    collectedCents: 10000,
    owedCents: 21650,
    expenseCents: 15000,
    cashLeftCents: -5000,
    costCents: 15000,
    estimatedProfitCents: 10000,
  });
  const [payment] = await f.run((tx) =>
    tx
      .select()
      .from(invoicePayment)
      .where(eq(invoicePayment.invoiceId, issued.id)),
  );
  await f.run((tx) =>
    reverseInvoicePayment(tx, meta(), payment.id, "Incorrect receipt"),
  );
  expect((await f.run((tx) => getOwnerMoney(tx, month))).collectedCents).toBe(
    0,
  );
  expect((await f.run((tx) => getOwnerMoney(tx, month))).owedCents).toBe(31650);
  await expect(
    withTenant(f.t.businessId, f.t.staff!.actor, (tx) =>
      getOwnerMoney(tx, month),
    ),
  ).rejects.toThrow(/owner/);
  // More than the old 100-row UI limit must remain visible in the actual totals.
  await f.run((tx) =>
    tx.execute(
      sql`insert into app.expense(business_id,created_by_user_id,spent_on,description,category,amount_cents) select ${f.t.businessId},${f.t.owner.userId},${spentOn}::date,'Supply '||n,'supplies',1 from generate_series(1,101) n`,
    ),
  );
  expect((await f.run((tx) => getOwnerMoney(tx, month))).expenseCents).toBe(
    15101,
  );
  // Editing a job later cannot rewrite quote-time costs already used for this invoice.
  await f.run((tx) =>
    createJob(tx, {
      customerId: f.c.id,
      vehicleId: f.v.id,
      jobId: j.id,
      expectedVersion: saved.version,
      title: "Later edit",
      parts: [{ ...parts[0], unitCostCents: 99999 }],
      labor,
    }),
  );
  expect((await f.run((tx) => getOwnerMoney(tx, month))).costCents).toBe(15000);
});
it("caps active common jobs at 25 under concurrent requests and keeps existing jobs unchanged", async () => {
  const f = await fixture("Common jobs");
  await f.run((tx) =>
    updateBusinessProfile(tx, meta(), {
      legalName: "Common shop",
      timezone: "America/Chicago",
      laborSellRateCents: 12500,
      laborCostRateCents: 4000,
    }),
  );
  const all = await Promise.allSettled(
    Array.from({ length: 27 }, (_, i) =>
      f.run((tx) =>
        saveCommonJob(tx, meta(), { name: `Brakes ${i}`, parts, labor }),
      ),
    ),
  );
  expect(all.filter((x) => x.status === "fulfilled")).toHaveLength(25);
  const saved = await f.run((tx) => listCommonJobs(tx));
  expect(saved).toHaveLength(25);
  await expect(
    withTenant(f.t.businessId, f.t.staff!.actor, (tx) =>
      saveCommonJob(tx, meta(), { name: "Staff", parts, labor }),
    ),
  ).rejects.toThrow();
  const other = await fixture("Other common");
  expect(await other.run((tx) => listCommonJobs(tx))).toEqual([]);
  await f.run((tx) => archiveCommonJob(tx, meta(), saved[0].id));
  await f.run((tx) =>
    saveCommonJob(tx, meta(), { name: "Replacement", parts, labor }),
  );
  expect(await f.run((tx) => listCommonJobs(tx))).toHaveLength(25);
});
it("finds visits beyond tomorrow across a DST week and never includes another shop", async () => {
  const f = await fixture("Week visits"),
    other = await fixture("Other visits");
  await f.run((tx) =>
    createAppointment(tx, meta(), {
      customerId: f.c.id,
      vehicleId: f.v.id,
      localStartsAt: "2026-11-05T09:00",
      reason: "Thursday brakes",
    }),
  );
  await other.run((tx) =>
    createAppointment(tx, meta(), {
      customerId: other.c.id,
      localStartsAt: "2026-11-05T09:00",
      reason: "Other private visit",
    }),
  );
  const week = await f.run((tx) =>
    listVisitsRange(tx, "2026-11-02", "2026-11-09"),
  );
  expect(week.rows).toHaveLength(1);
  expect(week.rows[0].reason).toBe("Thursday brakes");
  expect(week.rows[0].startsAt.toISOString()).toBe("2026-11-05T15:00:00.000Z");
  expect(
    (await f.run((tx) => listVisitsRange(tx, "2026-10-26", "2026-11-02"))).rows,
  ).toHaveLength(0);
});
