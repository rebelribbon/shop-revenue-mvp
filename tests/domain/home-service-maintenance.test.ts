import { signTestEstimate as signEstimate } from "../helpers/authorization";
import { expect, it } from "vitest";
import { asset, recoveryItem } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { createCustomer } from "@/domain/customers";
import {
  saveServiceAsset,
  serviceAssetInput,
  setServiceAssetNextService,
} from "@/domain/service-assets";
import {
  getMoneyFinder,
  startRecoveryWork,
  setDoNotContact,
} from "@/domain/money-finder";
import {
  createAppointment,
  setAppointmentStatus,
  listTodayTomorrow,
} from "@/domain/appointments";
import { createJob, listJobs } from "@/domain/jobs";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice, recordInvoicePayment } from "@/domain/invoices";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { meta, seedTenant } from "../helpers/fixtures";
const now = new Date();
const today = localDateKey(now, "America/Chicago");
async function fixture() {
  const tenant = await seedTenant("HVAC maintenance");
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(tenant.businessId, tenant.owner.actor, fn);
  const customer = await run((tx) =>
    createCustomer(tx, meta(), {
      firstName: "Maintenance",
      lastName: "Homeowner",
    }),
  );
  const property = await run((tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: customer.id,
        type: "property",
        displayName: "Home",
        addressLine1: "456 Main St",
        city: "Cibolo",
        region: "TX",
        postalCode: "78108",
      }),
    ),
  );
  const equipment = await run((tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: customer.id,
        type: "equipment",
        displayName: "Upstairs AC",
        parentAssetId: property.id,
      }),
    ),
  );
  const other = await run((tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: customer.id,
        type: "equipment",
        displayName: "Downstairs AC",
        parentAssetId: property.id,
      }),
    ),
  );
  const plan = (
    id: string,
    on: string | null = today,
    amountCents: number | null = 15000,
  ) =>
    run((tx) =>
      setServiceAssetNextService(tx, meta(), {
        customerId: customer.id,
        assetId: id,
        on,
        description: "Seasonal tune-up",
        amountCents,
      }),
    );
  const dashboard = () =>
    run((tx) => getMoneyFinder(tx, { category: "service_due", now }));
  return { tenant, run, customer, property, equipment, other, plan, dashboard };
}
it("shows real equipment service dates and inherited addresses, respecting due windows and contact preferences", async () => {
  const f = await fixture();
  await f.plan(f.equipment.id, today, null);
  let data = await f.dashboard();
  expect(data.hasServiceDates).toBe(true);
  expect(data.items).toEqual([
    expect.objectContaining({
      subjectId: f.equipment.id,
      serviceAssetId: f.equipment.id,
      vehicleId: null,
      amountCents: null,
      vehicleLabel: "Upstairs AC · 456 Main St, Cibolo",
    }),
  ]);
  await f.plan(f.other.id, addLocalDays(today, 15));
  expect((await f.dashboard()).total).toBe(1);
  await f.plan(f.other.id, addLocalDays(today, 14));
  expect((await f.dashboard()).total).toBe(2);
  await f.plan(f.other.id, addLocalDays(today, -91));
  expect((await f.dashboard()).total).toBe(1);
  await f.plan(f.other.id, addLocalDays(today, -90));
  expect((await f.dashboard()).total).toBe(2);
  await f.run((tx) => setDoNotContact(tx, meta(), f.customer.id, true));
  expect((await f.dashboard()).items).toEqual([]);
  await f.run((tx) => setDoNotContact(tx, meta(), f.customer.id, false));
  await f.plan(f.equipment.id, null);
  await f.plan(f.other.id, null);
  data = await f.dashboard();
  expect(data.items).toEqual([]);
  expect(data.hasServiceDates).toBe(false);
  const otherTenant = await seedTenant("Other maintenance");
  await expect(
    withTenant(otherTenant.businessId, otherTenant.owner.actor, (tx) =>
      setServiceAssetNextService(tx, meta(), {
        customerId: f.customer.id,
        assetId: f.equipment.id,
        on: today,
        description: "Intruder",
        amountCents: 1,
      }),
    ),
  ).rejects.toThrow();
  await expect(f.plan(f.equipment.id, "2026-02-30")).rejects.toThrow();
});
it("keeps a service-due source on its equipment through booking and job creation and shows the parent property's address", async () => {
  const f = await fixture();
  await f.plan(f.equipment.id);
  const start = await f.run((tx) =>
    startRecoveryWork(tx, meta(), {
      category: "service_due",
      subjectId: f.equipment.id,
      destination: "appointment",
    }),
  );
  expect(
    new URL(start.redirectTo, "https://example.test").searchParams.get(
      "serviceAssetId",
    ),
  ).toBe(f.equipment.id);
  expect(
    (await f.run((tx) => tx.select().from(recoveryItem)))[0],
  ).toMatchObject({ serviceAssetId: f.equipment.id, vehicleId: null });
  await expect(
    f.run((tx) =>
      createAppointment(tx, meta(), {
        customerId: f.customer.id,
        serviceAssetId: f.other.id,
        sourceRecoveryItemId: start.id,
        localStartsAt: `${addLocalDays(today, 1)}T10:00`,
      }),
    ),
  ).rejects.toThrow(/location/);
  const appt = await f.run((tx) =>
    createAppointment(tx, meta(), {
      customerId: f.customer.id,
      serviceAssetId: f.equipment.id,
      sourceRecoveryItemId: start.id,
      localStartsAt: `${addLocalDays(today, 1)}T10:00`,
      reason: "Tune-up",
    }),
  );
  expect((await f.dashboard()).items).toEqual([]);
  const days = await f.run((tx) => listTodayTomorrow(tx, now));
  expect(days.tomorrow.find((a) => a.id === appt.id)).toMatchObject({
    serviceAssetName: "Upstairs AC",
    serviceAddress: "456 Main St, Cibolo, TX, 78108",
  });
  const input = {
    customerId: f.customer.id,
    serviceAssetId: f.equipment.id,
    sourceRecoveryItemId: start.id,
    sourceAppointmentId: appt.id,
    title: "Tune-up",
    parts: [],
    labor: [
      {
        description: "Tune-up labor",
        estimatedHoursHundredths: 100,
        actualHoursHundredths: 100,
        sellRateCents: 15000,
        costRateCents: 4000,
      },
    ],
  };
  await expect(
    f.run((tx) => createJob(tx, { ...input, serviceAssetId: f.other.id })),
  ).rejects.toThrow();
  await f.run((tx) => createJob(tx, input));
  await f.run((tx) => setAppointmentStatus(tx, meta(), appt.id, "cancelled"));
  expect((await f.dashboard()).items).toHaveLength(1);
});
it("resolves maintenance after fully paid work on the same equipment, preserving other equipment opportunities", async () => {
  const f = await fixture();
  await f.plan(f.equipment.id);
  await f.plan(f.other.id);
  const job = await f.run((tx) =>
    createJob(tx, {
      customerId: f.customer.id,
      serviceAssetId: f.equipment.id,
      title: "Completed tune-up",
      parts: [
        {
          description: "Service",
          quantity: 1,
          unitCostCents: 4000,
          unitPriceCents: 15000,
        },
      ],
      labor: [],
    }),
  );
  const [saved] = await f.run((tx) => listJobs(tx));
  const estimate = await f.run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: job.id,
      expectedJobVersion: saved.version,
      taxBps: 0,
      supplementReason: "",
      terms: "",
    }),
  );
  await signEstimate(
    estimate.path.split("/").pop()!,
    "Homeowner",
    ["part-0"],
    meta(),
  );
  const bill = await f.run((tx) =>
    issueInvoice(tx, meta(), {
      versionId: estimate.id,
      dueOn: null,
      terms: "",
    }),
  );
  await f.run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: bill.id,
      amountCents: 5000,
      method: "cash",
      reference: "Deposit",
    }),
  );
  expect((await f.dashboard()).items).toHaveLength(2);
  await f.run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: bill.id,
      amountCents: 10000,
      method: "cash",
      reference: "Balance",
    }),
  );
  // The dashboard's as-of must include the just-recorded payment.
  const data = await f.run((tx) =>
    getMoneyFinder(tx, { category: "service_due", now: new Date() }),
  );
  expect(data.items.map((i) => i.serviceAssetId)).toEqual([f.other.id]);
  await expect(
    f.run((tx) =>
      tx.insert(asset).values({
        businessId: f.tenant.businessId,
        customerId: f.customer.id,
        type: "property",
        displayName: "Invalid plan",
        nextServiceDescription: "No date",
      }),
    ),
  ).rejects.toThrow();
});
