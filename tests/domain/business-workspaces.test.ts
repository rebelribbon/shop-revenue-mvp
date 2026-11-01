import { signTestEstimate as signEstimate } from "../helpers/authorization";
import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  asset,
  business,
  estimateVersion,
  invoice,
  recommendation,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/domain/business-profile";
import { createCustomer } from "@/domain/customers";
import {
  saveServiceAsset,
  serviceAssetInput,
  listServiceAssets,
  archiveServiceAsset,
} from "@/domain/service-assets";
import { createJob, listJobs } from "@/domain/jobs";
import { freezeEstimate, readPublicEstimate } from "@/domain/estimates";
import {
  issueInvoice,
  readPublicInvoice,
  recordInvoicePayment,
} from "@/domain/invoices";
import { getMoneyFinder } from "@/domain/money-finder";
import { meta, seedTenant } from "../helpers/fixtures";

it("lets only an owner select a tenant workspace and preserves records when switching", async () => {
  const a = await seedTenant("Workspace", { withStaff: true });
  expect(
    (
      await withTenant(a.businessId, a.owner.actor, (tx) =>
        getBusinessProfile(tx),
      )
    )?.businessType,
  ).toBe("automotive");
  const profile = {
    legalName: "AC Experts",
    timezone: "America/Chicago",
    businessType: "hvac" as const,
  };
  await expect(
    withTenant(a.businessId, a.staff!.actor, (tx) =>
      updateBusinessProfile(tx, meta(), profile),
    ),
  ).rejects.toThrow();
  await withTenant(a.businessId, a.owner.actor, (tx) =>
    updateBusinessProfile(tx, meta(), profile),
  );
  expect(
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      getBusinessProfile(tx),
    ),
  ).toMatchObject({ businessType: "hvac", businessTypeSelected: true });
  const c = await withTenant(a.businessId, a.owner.actor, (tx) =>
    createCustomer(tx, meta(), { firstName: "Homeowner", lastName: "One" }),
  );
  await withTenant(a.businessId, a.owner.actor, (tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: c.id,
        type: "property",
        displayName: "Home",
        addressLine1: "123 Main St",
      }),
    ),
  );
  await withTenant(a.businessId, a.owner.actor, (tx) =>
    updateBusinessProfile(tx, meta(), {
      ...profile,
      businessType: "automotive",
    }),
  );
  expect(
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      listServiceAssets(tx, c.id),
    ),
  ).toHaveLength(1);
  await expect(
    withTenant(a.businessId, a.owner.actor, (tx) =>
      tx
        .update(business)
        .set({ businessType: "made_up" })
        .where(eq(business.id, a.businessId)),
    ),
  ).rejects.toThrow();
});

it("isolates properties and equipment by tenant AND customer, including direct database writes", async () => {
  const a = await seedTenant("Homes"),
    b = await seedTenant("Other homes");
  const c = await withTenant(a.businessId, a.owner.actor, (tx) =>
    createCustomer(tx, meta(), { firstName: "Resident", lastName: "A" }),
  );
  const d = await withTenant(a.businessId, a.owner.actor, (tx) =>
    createCustomer(tx, meta(), { firstName: "Resident", lastName: "B" }),
  );
  const property = await withTenant(a.businessId, a.owner.actor, (tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: c.id,
        type: "property",
        displayName: "Rental",
        addressLine1: "123 Rental St",
      }),
    ),
  );
  await expect(
    withTenant(a.businessId, a.owner.actor, (tx) =>
      saveServiceAsset(
        tx,
        meta(),
        serviceAssetInput.parse({
          customerId: d.id,
          type: "equipment",
          displayName: "AC",
          parentAssetId: property.id,
        }),
      ),
    ),
  ).rejects.toThrow();
  await expect(
    withTenant(a.businessId, a.owner.actor, (tx) =>
      tx.insert(asset).values({
        businessId: a.businessId,
        customerId: d.id,
        parentAssetId: property.id,
        type: "equipment",
        displayName: "Wrong resident",
      }),
    ),
  ).rejects.toThrow();
  await expect(
    withTenant(b.businessId, b.owner.actor, (tx) =>
      tx.insert(asset).values({
        businessId: b.businessId,
        customerId: c.id,
        type: "property",
        displayName: "Intruder",
      }),
    ),
  ).rejects.toThrow();
  expect(
    await withTenant(b.businessId, b.owner.actor, (tx) =>
      listServiceAssets(tx),
    ),
  ).toEqual([]);
  const equipment = await withTenant(a.businessId, a.owner.actor, (tx) =>
    saveServiceAsset(
      tx,
      meta(),
      serviceAssetInput.parse({
        customerId: c.id,
        type: "equipment",
        displayName: "Upstairs AC",
        parentAssetId: property.id,
        serialNumber: "SECRET-SERIAL",
        notes: "Private gate code 1234",
      }),
    ),
  );
  await expect(
    withTenant(b.businessId, b.owner.actor, (tx) =>
      createJob(tx, {
        customerId: c.id,
        serviceAssetId: equipment.id,
        title: "Intruder",
        parts: [],
        labor: [],
      }),
    ),
  ).rejects.toThrow();
  await withTenant(a.businessId, a.owner.actor, (tx) =>
    archiveServiceAsset(tx, meta(), c.id, property.id),
  );
  expect(
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      listServiceAssets(tx, c.id),
    ),
  ).toEqual([]);
});

it("costs, authorizes, invoices and pays a home-service job without any vehicle; freezes the service address and keeps costs private", async () => {
  const a = await seedTenant("Plumbing");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(a.businessId, a.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Water", lastName: "Customer" }),
  );
  const propertyInput = serviceAssetInput.parse({
    customerId: c.id,
    type: "property",
    displayName: "Main home",
    addressLine1: "456 Water St",
    city: "Cibolo",
    region: "TX",
    postalCode: "78108",
    notes: "Private access code 9988",
  });
  const p = await run((tx) => saveServiceAsset(tx, meta(), propertyInput));
  const input = {
    customerId: c.id,
    serviceAssetId: p.id,
    title: "Water heater replacement",
    parts: [
      {
        description: "New heater",
        quantity: 1,
        unitCostCents: 12345,
        unitPriceCents: 80000,
      },
    ],
    labor: [
      {
        description: "Install",
        estimatedHoursHundredths: 200,
        actualHoursHundredths: 250,
        sellRateCents: 15000,
        costRateCents: 3500,
      },
    ],
  };
  const j = await run((tx) => createJob(tx, input));
  const [saved] = await run((tx) => listJobs(tx));
  const e = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: j.id,
      expectedJobVersion: saved.version,
      taxBps: 0,
      supplementReason: "",
      terms: "Customer-approved scope only.",
    }),
  );
  const token = e.path.split("/").pop()!;
  const publicEstimate = await readPublicEstimate(token);
  expect(publicEstimate?.snapshot).toMatchObject({
    serviceLabel: "Main home, 456 Water St, Cibolo, TX, 78108",
    totalCents: 110000,
  });
  expect(JSON.stringify(publicEstimate)).not.toMatch(
    /12345|costRate|unitCost|actualHours|9988/,
  );
  await run((tx) =>
    saveServiceAsset(tx, meta(), {
      ...propertyInput,
      assetId: p.id,
      addressLine1: "Changed address",
    }),
  );
  expect((await readPublicEstimate(token))?.snapshot.serviceLabel).toContain(
    "456 Water St",
  );
  await signEstimate(token, "Homeowner", ["part-0"], meta());
  expect(
    (await run((tx) => tx.select().from(recommendation)))[0],
  ).toMatchObject({ vehicleId: null, description: "Install" });
  const now = new Date(Date.now() + 5 * 86400000);
  const money = await run((tx) => getMoneyFinder(tx, { now }));
  expect(
    money.items.some((i) => i.category === "declined" && i.customerId === c.id),
  ).toBe(true);
  const issued = await run((tx) =>
    issueInvoice(tx, meta(), {
      versionId: e.id,
      dueOn: null,
      terms: "Due on completion",
    }),
  );
  const visible = await readPublicInvoice(issued.path.split("/").pop()!);
  expect(visible).toMatchObject({
    totalCents: 80000,
    snapshot: { serviceLabel: "Main home, 456 Water St, Cibolo, TX, 78108" },
  });
  await run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: issued.id,
      amountCents: 80000,
      method: "cash",
      reference: "Home receipt",
    }),
  );
  expect(
    (await readPublicInvoice(issued.path.split("/").pop()!))?.paidCents,
  ).toBe(80000);
  await expect(
    run((tx) =>
      tx
        .update(estimateVersion)
        .set({ serviceAssetId: null })
        .where(eq(estimateVersion.id, e.id)),
    ),
  ).rejects.toThrow();
  await expect(
    run((tx) =>
      tx
        .update(invoice)
        .set({ serviceAssetId: null })
        .where(eq(invoice.id, issued.id)),
    ),
  ).rejects.toThrow();
  await expect(
    run((tx) =>
      tx.execute(
        sql`INSERT INTO app.asset(business_id,customer_id,type,display_name) VALUES(${a.businessId},${c.id},'invalid','bad')`,
      ),
    ),
  ).rejects.toThrow();
});
