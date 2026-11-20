import { beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customerPacketPath } from "@/domain/document-sharing";
import { document } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createCustomer,
  createVehicle,
  updateCustomer,
} from "@/domain/customers";
import {
  STARTER_TEMPLATES,
  unsafeCustomerPricedChangeOrder,
  fileDocument,
  jobCabinet,
  listAttachments,
  prepareDocumentUpload,
  readPublicDocument,
  readPublicDocumentPdf,
  saveTemplate,
  sendDocument,
  signDocument,
  voidDocument,
} from "@/domain/documents";
import { createJob } from "@/domain/jobs";
import { assignCustomer } from "@/domain/assignments";
import { writeLocal } from "@/lib/media-storage";
import { meta, seedTenant } from "../helpers/fixtures";

beforeAll(() => {
  process.env.MEDIA_STORAGE = "local";
  process.env.MEDIA_LOCAL_DIR = "/tmp/shop-revenue-test-media";
});
const signature = [
  [
    { x: 0.1, y: 0.2 },
    { x: 0.5, y: 0.6 },
  ],
];

it("owner builds a template; a job sends it; the customer fills, signs and gets a sealed PDF", async () => {
  const t = await seedTenant("Docs", { withStaff: true });
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Pat", lastName: "Signer" }),
  );
  await run((tx) =>
    updateCustomer(tx, meta(), c.id, {
      firstName: "Pat",
      lastName: "Signer",
      addressLine1: "12 Oak St",
      city: "Austin",
      region: "TX",
      postalCode: "78701",
    }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      parts: [],
      labor: [
        {
          description: "Labor",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          sellRateCents: 9000,
          costRateCents: null,
        },
      ],
    }),
  );
  const template = {
    name: "Work authorization",
    body: "I, {{customer_name}} of {{customer_address}}, approve {{job_title}} on {{job_location}} for {{job_total}}. {{unknown}}",
    fields: [
      {
        key: "phone",
        label: "Best phone",
        type: "text" as const,
        required: true,
      },
      {
        key: "keys",
        label: "Keys left",
        type: "checkbox" as const,
        required: false,
      },
    ],
  };
  // Staff can't change the shop's templates.
  await expect(
    withTenant(t.businessId, t.staff!.actor, (tx) =>
      saveTemplate(tx, meta(), template),
    ),
  ).rejects.toThrow();
  const tpl = await run((tx) => saveTemplate(tx, meta(), template));
  await run((tx) =>
    assignCustomer(tx, meta(), { customerId: c.id, userId: t.staff!.userId }),
  );
  const sent = await withTenant(t.businessId, t.staff!.actor, (tx) =>
    sendDocument(tx, meta(), { jobId: job.id, templateId: tpl.id }),
  );
  const token = sent.path.split("/").pop()!;
  const pub = await readPublicDocument(token);
  expect(pub!.body).toBe(
    "I, Pat Signer of 12 Oak St, Austin, TX, 78701, approve Brakes on Ford for $90.00. {{unknown}}",
  );
  // Editing the template later doesn't change what was sent.
  await run((tx) =>
    saveTemplate(tx, meta(), {
      ...template,
      templateId: tpl.id,
      body: "Changed",
    }),
  );
  expect((await readPublicDocument(token))!.body).toBe(pub!.body);
  await expect(
    signDocument(token, { name: "Pat Signer", values: {}, signature }, meta()),
  ).rejects.toThrow(/Best phone/);
  await signDocument(
    token,
    {
      name: "Pat Signer",
      values: { phone: "512-555-0100", keys: true },
      signature,
    },
    { ...meta(), userAgent: "Test phone" },
  );
  const signed = await readPublicDocument(token);
  expect(signed).toMatchObject({
    status: "signed",
    signerName: "Pat Signer",
    values: { phone: "512-555-0100", keys: true },
  });
  const pdf = await readPublicDocumentPdf(token);
  expect(pdf!.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(
    signDocument(
      token,
      { name: "Again", values: { phone: "x" }, signature },
      meta(),
    ),
  ).rejects.toThrow();
  // Signed evidence can't be rewritten.
  await expect(
    run((tx) =>
      tx
        .update(document)
        .set({ status: "sent" })
        .where(eq(document.id, signed!.id)),
    ),
  ).rejects.toThrow();
  const cabinet = await run((tx) => jobCabinet(tx, job.id, () => null));
  expect(cabinet.find((i) => i.documentId === signed!.id)).toMatchObject({
    group: "Signed & sent",
    status: "Signed",
    href: `/app/documents/${signed!.id}/pdf`,
  });
  // A second document, voided, stops working for the customer.
  const second = await run((tx) =>
    sendDocument(tx, meta(), { jobId: job.id, templateId: tpl.id }),
  );
  await run((tx) => voidDocument(tx, meta(), second.id, "Sent by mistake"));
  expect(await readPublicDocument(second.path.split("/").pop()!)).toBeNull();
});

it("keeps customer attachments separate from job files", async () => {
  const t = await seedTenant("Attach");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Lic", lastName: "TEST" }),
  );
  const prep = await run((tx) =>
    prepareDocumentUpload(tx, {
      customerId: c.id,
      contentType: "application/pdf",
      byteSize: 10,
    }),
  );
  await writeLocal(
    new URL(prep.uploadUrl, "http://x").searchParams.get("key")!,
    Buffer.from("%PDF-1.4 x"),
  );
  await run((tx) =>
    fileDocument(tx, meta(), {
      fileId: prep.fileId,
      customerId: c.id,
      category: "license",
      title: "",
    }),
  );
  const list = await run((tx) => listAttachments(tx, c.id));
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    title: "Driver’s license / ID",
    category: "license",
  });
  await expect(
    run((tx) =>
      prepareDocumentUpload(tx, {
        customerId: c.id,
        contentType: "application/zip",
        byteSize: 10,
      }),
    ),
  ).rejects.toThrow(/PDF/);
});

it("keeps change order scope and prices controlled by the shop, not the signer", () => {
  const change = STARTER_TEMPLATES.find((t) => t.name === "Change order")!;
  expect(change.fields).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ key: "added_cost" })]),
  );
  expect(change.fields).toEqual([
    expect.objectContaining({
      key: "confirm_change",
      type: "checkbox",
      required: true,
    }),
  ]);
  expect(change.body).toContain("{{change_summary}}");
  expect(change.body).toContain("{{change_delta}}");
  expect(
    unsafeCustomerPricedChangeOrder({
      title: "Change order",
      fields: [
        {
          key: "change",
          type: "text",
          required: true,
          label: "What is changing",
        },
        {
          key: "added_cost",
          type: "text",
          required: true,
          label: "Added cost",
        },
      ],
    }),
  ).toBe(true);
  expect(
    unsafeCustomerPricedChangeOrder({
      title: "Change order",
      fields: change.fields,
    }),
  ).toBe(false);
});

it("creates one customer packet link with immutable estimate and document tokens", () => {
  const estimateToken = "A".repeat(43);
  const docToken = "B".repeat(43);
  const path = customerPacketPath(`/estimate/${estimateToken}`, [
    {
      id: "signed-document",
      title: "Work authorization",
      path: `/sign/${docToken}`,
    },
  ]);
  const url = new URL(path, "https://shop.example.test");
  expect(url.pathname).toBe("/packet");
  expect(url.searchParams.get("e")).toBe(estimateToken);
  expect(url.searchParams.getAll("d")).toEqual([docToken]);
  expect(() => customerPacketPath("/estimate/not-a-token", [])).toThrow(
    /new sharing link/,
  );
});
