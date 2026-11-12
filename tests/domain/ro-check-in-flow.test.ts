import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicle } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assignJob } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { jobCabinet } from "@/domain/documents";
import { freezeEstimate, readPublicEstimate } from "@/domain/estimates";
import {
  addInspectionToJob,
  getInspection,
  saveInspection,
} from "@/domain/inspections";
import { issueInvoice, recordInvoicePayment } from "@/domain/invoices";
import { jobProfit } from "@/domain/job-profit";
import { createJob, getJob, jobInput } from "@/domain/jobs";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import { prepareReceipt, sendReceipt } from "@/domain/receipts";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

async function shop(label: string, customerEmail: string | null) {
  const t = await seedTenant(label);
  const owner = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const email = `tech-${randomUUID()}@shop.example.test`;
  const inv = await owner((tx) =>
    inviteStaff(tx, meta(), { name: "Tess Tech", email, role: "technician" }),
  );
  const authSubject = randomUUID();
  const joined = await acceptInvite(meta(), inv.token, {
    authSubject,
    email,
    phoneE164: null,
    displayName: "Tess Tech",
  });
  const tech = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(
      t.businessId,
      { type: "user", id: joined.userId, authSubject },
      fn,
    );
  const c = await owner((tx) =>
    createCustomer(tx, meta(), {
      firstName: "Casey",
      lastName: "TEST",
      ...(customerEmail ? { email: customerEmail } : {}),
    }),
  );
  const v = await owner((tx) =>
    createVehicle(tx, meta(), {
      customerId: c.id,
      make: "Ford",
      mileage: 80000,
    }),
  );
  return { t, owner, tech, techId: joined.userId, c, v };
}

describe("RO check-in to receipt", () => {
  it("carries concerns, miles and the inspection to the customer, shows costs and profit, and emails a receipt", async () => {
    const customerEmail = `casey-${randomUUID()}@example.test`;
    const f = await shop("CheckIn", customerEmail);
    // Steps 3-4: miles in and the customer's concerns at check-in.
    const job = await f.owner((tx) =>
      createJob(tx, {
        customerId: f.c.id,
        vehicleId: f.v.id,
        title: "Brake noise",
        mileageIn: 84250,
        concerns: "Grinding from the front when braking.",
        parts: [
          {
            description: "Front pads",
            quantity: 1,
            unitCostCents: 4000,
            unitPriceCents: 10000,
          },
        ],
        labor: [
          {
            description: "Replace front pads",
            estimatedHoursHundredths: 150,
            actualHoursHundredths: null,
            sellRateCents: 12000,
            costRateCents: 4000,
          },
        ],
      }),
    );
    const [row] = await f.owner((tx) =>
      tx
        .select({ mileage: vehicle.mileage })
        .from(vehicle)
        .where(
          and(eq(vehicle.businessId, f.t.businessId), eq(vehicle.id, f.v.id)),
        ),
    );
    expect(row.mileage).toBe(84250);

    // Costs and profit, line by line.
    const profit = (await f.owner((tx) => jobProfit(tx, job.id)))!;
    expect(profit.lines).toEqual([
      expect.objectContaining({
        description: "Front pads",
        costCents: 4000,
        priceCents: 10000,
      }),
      expect.objectContaining({
        description: "Replace front pads",
        costCents: 6000,
        priceCents: 18000,
      }),
    ]);
    expect(profit.partsCostCents).toBe(4000);
    expect(profit.laborCostCents).toBe(6000);
    expect(profit.profitCents).toBe(18000);

    // Steps 6-8: the technician inspects and recommends work.
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: job.id, userId: f.techId }),
    );
    const blank = await f.tech((tx) => getInspection(tx, job.id));
    await f.tech((tx) =>
      saveInspection(tx, meta(), {
        jobId: job.id,
        submit: true,
        assessment: {
          diagnosis: "Front pads at 2 mm, rotors scored.",
          bay: "Bay 2",
          vehiclePickedUp: true,
        },
        items: blank.items.map((i, n) =>
          n === 0
            ? {
                ...i,
                status: "fix" as const,
                note: "Leaking at the cap",
                recommendedWork: "Replace coolant reservoir",
              }
            : { ...i, status: "good" as const },
        ),
      }),
    );
    await f.owner((tx) => addInspectionToJob(tx, meta(), job.id));
    const saved = (await f.owner((tx) => getJob(tx, job.id)))!;
    expect(jobInput.parse(saved.data).labor.at(-1)?.fromInspection).toBe(true);

    // Step 9-13: the estimate carries all of it to the customer.
    const estimate = await f.owner((tx) =>
      freezeEstimate(tx, meta(), {
        jobId: job.id,
        expectedJobVersion: saved.version,
        taxBps: 0,
        supplementReason: "",
        terms: "",
      }),
    );
    const token = estimate.path.split("/").pop()!;
    const pub = (await readPublicEstimate(token))!;
    expect(pub.snapshot.concerns).toBe("Grinding from the front when braking.");
    expect(pub.snapshot.mileageIn).toBe(84250);
    expect(pub.snapshot.inspection?.diagnosis).toContain("2 mm");
    expect(pub.snapshot.inspection?.findings).toEqual([
      expect.objectContaining({
        status: "fix",
        note: "Leaking at the cap",
        recommendedWork: "Replace coolant reservoir",
      }),
    ]);
    expect(pub.snapshot.lines.map((l) => !!l.recommended)).toEqual([
      false,
      false,
      true,
    ]);
    // Internal costs never reach the customer.
    expect(JSON.stringify(pub.snapshot)).not.toMatch(/unitCost|costRate/);

    // Steps 14-16: invoice, payment, emailed receipt, all in the cabinet.
    await signTestEstimate(token, "Casey TEST", ["part-0", "labor-0"], meta());
    const invoice = await f.owner((tx) =>
      issueInvoice(tx, meta(), {
        versionId: estimate.id,
        dueOn: null,
        terms: "",
      }),
    );
    const receipt = await f.owner(async (tx) => {
      const p = await recordInvoicePayment(tx, meta(), {
        invoiceId: invoice.id,
        amountCents: 28000,
        method: "cash",
        reference: "",
      });
      return prepareReceipt(tx, p.id);
    });
    expect(receipt?.email.to).toBe(customerEmail);
    expect(receipt?.email.subject).toMatch(/^Receipt from .+: invoice #\d+$/);
    expect(receipt?.email.text).toContain("Amount paid: $280.00");
    expect(receipt?.email.text).toContain("Paid in full.");
    expect(receipt?.email.text).toContain("Front pads: $100.00");
    expect(receipt?.email.text).toContain(
      "View your invoice: http://localhost:3000/invoice/",
    );
    expect(await sendReceipt(receipt)).toBe(true);
    expect(mail.sent.filter((m) => m.to === customerEmail)).toHaveLength(1);

    const cabinet = await f.owner((tx) => jobCabinet(tx, job.id, () => null));
    const titles = cabinet.map((i) => i.title);
    expect(titles).toContain("Inspection report");
    expect(titles).toContain("Receipt · $280.00");
    expect(cabinet.find((i) => i.title === "Receipt · $280.00")?.status).toBe(
      "Emailed",
    );
    expect(titles.some((t) => t.startsWith("Invoice #"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Estimate"))).toBe(true);
  });

  it("never lowers the vehicle's mileage, and sends no receipt without an email address", async () => {
    const f = await shop("CheckInNo", null);
    await f.owner((tx) =>
      createJob(tx, {
        customerId: f.c.id,
        vehicleId: f.v.id,
        title: "Oil change",
        mileageIn: 1200,
        parts: [
          {
            description: "Oil",
            quantity: 1,
            unitCostCents: 1000,
            unitPriceCents: 3000,
          },
        ],
        labor: [],
      }),
    );
    const [row] = await f.owner((tx) =>
      tx
        .select({ mileage: vehicle.mileage })
        .from(vehicle)
        .where(
          and(eq(vehicle.businessId, f.t.businessId), eq(vehicle.id, f.v.id)),
        ),
    );
    expect(row.mileage).toBe(80000);
    expect(await sendReceipt(null)).toBe(false);
  });
});
