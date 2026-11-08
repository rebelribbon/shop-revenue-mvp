// Customer attachments, the job file cabinet, and e-sign documents built from
// the owner's templates. A sent document's text is frozen; the customer's
// signature, entries and device evidence are sealed into a PDF.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";
import {
  business,
  customer,
  document,
  documentTemplate,
  estimateAuthorization,
  estimateVersion,
  file,
  invoice,
  type DocumentField,
} from "@/db/schema";
import { runInContext, type TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import {
  signatureSchema,
  type SignatureStrokes,
} from "@/lib/estimate-decisions";
import { createUploadUrl, statObject } from "@/lib/media-storage";
import { sealShareToken } from "@/lib/share-token";
import { hashToken, isWellFormedToken, newToken } from "@/lib/tokens";
import { getJob, jobInput } from "./jobs";
import { calculateJob } from "./job-costing";
import { getVehicle } from "./customers";
import { serviceAssetLabel } from "./service-assets";
import { assertOwner } from "./membership";
import { audit, recordActivity, type RequestMeta } from "./records";

export const ATTACHMENT_CATEGORIES = [
  ["license", "Driver’s license / ID"],
  ["insurance", "Insurance card"],
  ["tax_exempt", "Tax-exempt certificate"],
  ["w9", "W-9"],
  ["contract", "Contract / agreement"],
  ["other", "Other"],
] as const;
export const JOB_FILE_CATEGORIES = [
  ["permit", "Permit"],
  ["quote", "Supplier quote"],
  ["inspection", "Inspection report"],
  ["receipt", "Receipt"],
  ["contract", "Contract / agreement"],
  ["other", "Other"],
] as const;
export const categoryLabel = (key: string) =>
  [...ATTACHMENT_CATEGORIES, ...JOB_FILE_CATEGORIES].find(
    ([k]) => k === key,
  )?.[1] ?? key;

export const DOCUMENT_FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};
const MAX_DOC_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------- templates

export const MERGE_FIELDS = [
  ["customer_name", "Customer name"],
  ["customer_address", "Customer address"],
  ["customer_phone", "Customer phone"],
  ["customer_email", "Customer email"],
  ["job_title", "Job name"],
  ["job_location", "Property / vehicle"],
  ["job_total", "Job total"],
  ["shop_name", "Your business name"],
  ["shop_phone", "Your phone"],
  ["shop_address", "Your address"],
  ["today", "Today’s date"],
] as const;

export const fieldSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters and _ only."),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["text", "date", "checkbox", "initials"]),
  required: z.boolean(),
});
export const templateInput = z.object({
  templateId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20000),
  fields: z.array(fieldSchema).max(30),
});

export async function listTemplates(tx: TenantTx, includeArchived = false) {
  return tx
    .select()
    .from(documentTemplate)
    .where(
      and(
        eq(documentTemplate.businessId, tx.businessId),
        includeArchived ? undefined : isNull(documentTemplate.archivedAt),
      ),
    )
    .orderBy(asc(documentTemplate.name));
}

export async function saveTemplate(
  tx: TenantTx,
  meta: RequestMeta,
  raw: z.infer<typeof templateInput>,
) {
  await assertOwner(tx);
  const input = templateInput.parse(raw);
  const keys = input.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length)
    throw new AppError("VALIDATION", "Each blank needs a different name.");
  if (input.templateId) {
    const [row] = await tx
      .update(documentTemplate)
      .set({
        name: input.name,
        body: input.body,
        fields: input.fields,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentTemplate.businessId, tx.businessId),
          eq(documentTemplate.id, input.templateId),
        ),
      )
      .returning({ id: documentTemplate.id });
    if (!row) throw notFound("That template");
    await audit(tx, meta, {
      action: "document_template.updated",
      targetType: "document_template",
      targetId: row.id,
      after: { name: input.name },
    });
    return { id: row.id };
  }
  const [row] = await tx
    .insert(documentTemplate)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      name: input.name,
      body: input.body,
      fields: input.fields,
    })
    .returning({ id: documentTemplate.id });
  await audit(tx, meta, {
    action: "document_template.created",
    targetType: "document_template",
    targetId: row.id,
    after: { name: input.name },
  });
  return { id: row.id };
}

export async function archiveTemplate(tx: TenantTx, templateId: string) {
  await assertOwner(tx);
  await tx
    .update(documentTemplate)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(documentTemplate.businessId, tx.businessId),
        eq(documentTemplate.id, templateId),
      ),
    );
  return { id: templateId };
}

// Starter templates an owner can add with one tap, then edit.
export const STARTER_TEMPLATES: z.infer<typeof templateInput>[] = [
  {
    name: "Work authorization",
    body: 'I, {{customer_name}}, authorize {{shop_name}} to perform the work described for "{{job_title}}" at {{job_location}}. I understand the estimated total is {{job_total}} and that additional work requires my approval.\n\nDate: {{today}}',
    fields: [
      {
        key: "contact_phone",
        label: "Best phone to reach you",
        type: "text",
        required: true,
      },
      {
        key: "keys_left",
        label: "I left keys / access with the shop",
        type: "checkbox",
        required: false,
      },
    ],
  },
  {
    name: "Change order",
    body: 'Shop-prepared change order for "{{job_title}}" at {{job_location}}.\n\nChanges: {{change_summary}}\nPrice change: {{change_delta}}\nRevised estimated total: {{job_total}}\n\nI have reviewed the above changes and acknowledge the revised work and price. Any further changes require a new authorization.\n\nCustomer: {{customer_name}} · Date: {{today}}',
    fields: [
      {
        key: "confirm_change",
        label: "I reviewed the shop-prepared changes and price",
        type: "checkbox",
        required: true,
      },
    ],
  },
  {
    name: "Liability waiver",
    body: '{{customer_name}} understands the risks described by {{shop_name}} for "{{job_title}}" and releases {{shop_name}} from claims arising from those described risks, except for negligence. Date: {{today}}',
    fields: [
      {
        key: "risk_initials",
        label: "Initial: I understand the risks",
        type: "initials",
        required: true,
      },
    ],
  },
];

// ---------------------------------------------------------------- sending

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function mergeValues(tx: TenantTx, jobId: string) {
  const job = await getJob(tx, jobId);
  if (!job) throw notFound("That job");
  const input = jobInput.parse(job.data);
  const [c] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, input.customerId),
      ),
    );
  const [shop] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  const [latest, previous] = await tx
    .select({
      snapshot: estimateVersion.snapshot,
      version: estimateVersion.version,
      supplementReason: estimateVersion.supplementReason,
    })
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, jobId),
      ),
    )
    .orderBy(desc(estimateVersion.version))
    .limit(2);
  const join = (...p: (string | null | undefined)[]) =>
    p.filter(Boolean).join(", ");
  return {
    customerId: input.customerId,
    changeOrderReady: Boolean(
      latest && previous && latest.supplementReason?.trim(),
    ),
    values: {
      customer_name: c.displayName,
      customer_address: join(
        c.addressLine1,
        c.addressLine2,
        c.city,
        c.region,
        c.postalCode,
      ),
      customer_phone: c.phoneE164 ?? "",
      customer_email: c.email ?? "",
      job_title: job.title,
      job_location:
        latest?.snapshot.serviceLabel ||
        latest?.snapshot.vehicleLabel ||
        (input.serviceAssetId
          ? await serviceAssetLabel(tx, input.customerId, input.serviceAssetId)
          : input.vehicleId
            ? await getVehicle(tx, input.customerId, input.vehicleId).then(
                (v) =>
                  [v.year, v.make, v.model, v.plate].filter(Boolean).join(" "),
              )
            : ""),
      change_summary: latest?.supplementReason?.trim() ?? "",
      change_delta:
        latest && previous
          ? `${latest.snapshot.totalCents - previous.snapshot.totalCents >= 0 ? "+" : "-"}${money(Math.abs(latest.snapshot.totalCents - previous.snapshot.totalCents))}`
          : "—",
      // The sent estimate's total (with tax), or the job's quoted subtotal.
      job_total: latest
        ? money(latest.snapshot.totalCents)
        : money(calculateJob(input.parts, input.labor).subtotalCents),
      shop_name: shop.dba || shop.legalName,
      shop_phone: shop.phoneE164 ?? "",
      shop_address: join(
        shop.addressLine1,
        shop.city,
        shop.region,
        shop.postalCode,
      ),
      today: new Date().toLocaleDateString("en-US", {
        timeZone: shop.timezone,
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    } as Record<string, string>,
  };
}

export const fillMerge = (body: string, values: Record<string, string>) =>
  body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) =>
    k in values ? values[k] || "—" : m,
  );

export async function sendDocument(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; templateId: string },
) {
  const [t] = await tx
    .select()
    .from(documentTemplate)
    .where(
      and(
        eq(documentTemplate.businessId, tx.businessId),
        eq(documentTemplate.id, input.templateId),
        isNull(documentTemplate.archivedAt),
      ),
    );
  if (!t) throw notFound("That template");
  const { customerId, values, changeOrderReady } = await mergeValues(
    tx,
    input.jobId,
  );
  const isChangeOrder = t.name.trim().toLowerCase() === "change order";
  if (isChangeOrder && !changeOrderReady)
    throw new AppError(
      "VALIDATION",
      "Create and publish the updated estimate with its change reason before preparing a change order.",
    );
  // Legacy templates may ask the signer to invent the change and its price.
  // Never let a customer decide the amount of work or money on a change order.
  const safeChangeTemplate = STARTER_TEMPLATES.find(
    (item) => item.name === "Change order",
  )!;
  const frozenBody = fillMerge(
    isChangeOrder ? safeChangeTemplate.body : t.body,
    values,
  );
  const signerFields = isChangeOrder ? safeChangeTemplate.fields : t.fields;
  const token = newToken();
  const [row] = await tx
    .insert(document)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      customerId,
      jobId: input.jobId,
      kind: "esign",
      category: "esign",
      title: t.name,
      templateId: t.id,
      body: frozenBody,
      fields: signerFields,
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      status: "sent",
    })
    .returning({ id: document.id });
  await audit(tx, meta, {
    action: "document.sent",
    targetType: "document",
    targetId: row.id,
    after: { templateId: t.id, jobId: input.jobId },
  });
  await recordActivity(tx, {
    kind: "document.sent",
    subjectType: "customer",
    subjectId: customerId,
    summary: `Sent for signature: ${t.name}`,
    data: { documentId: row.id, jobId: input.jobId },
  });
  return { id: row.id, path: `/sign/${token.token}`, jobId: input.jobId };
}

export async function voidDocument(
  tx: TenantTx,
  meta: RequestMeta,
  documentId: string,
  reason: string,
) {
  const [d] = await tx
    .update(document)
    .set({
      status: "void",
      voidedAt: new Date(),
      voidReason: reason || "Voided by shop",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.id, documentId),
        isNull(document.deletedAt),
      ),
    )
    .returning({ id: document.id, status: document.status });
  if (!d) throw notFound("That document");
  await audit(tx, meta, {
    action: "document.voided",
    targetType: "document",
    targetId: d.id,
    after: { reason },
  });
  return { id: d.id };
}

// ---------------------------------------------------------------- uploads

export async function prepareDocumentUpload(
  tx: TenantTx,
  input: { customerId: string; contentType: string; byteSize: number },
) {
  const ext = DOCUMENT_FILE_TYPES[input.contentType];
  if (!ext)
    throw new AppError("VALIDATION", "Use a PDF or a photo (JPG, PNG, HEIC).");
  if (input.byteSize <= 0 || input.byteSize > MAX_DOC_BYTES)
    throw new AppError("VALIDATION", "Files can be up to 25 MB.");
  const [c] = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, input.customerId),
      ),
    );
  if (!c) throw notFound("That customer");
  const id = randomUUID();
  const storageKey = `b/${tx.businessId}/document/${id}.${ext}`;
  await tx.insert(file).values({
    id,
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    storageKey,
    kind: "document",
    contentType: input.contentType,
    byteSize: input.byteSize,
  });
  return { fileId: id, uploadUrl: await createUploadUrl(storageKey) };
}

export async function fileDocument(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    fileId: string;
    customerId: string;
    jobId?: string | null;
    category: string;
    title: string;
  },
) {
  const [f] = await tx
    .select()
    .from(file)
    .where(
      and(
        eq(file.businessId, tx.businessId),
        eq(file.id, input.fileId),
        eq(file.kind, "document"),
      ),
    )
    .for("update");
  if (!f || f.status !== "pending") throw notFound("That upload");
  if (input.jobId) {
    const job = await getJob(tx, input.jobId);
    if (
      !job ||
      (job.data as { customerId?: string }).customerId !== input.customerId
    )
      throw notFound("That job");
  }
  const stored = await statObject(f.storageKey);
  if (!stored || stored.size <= 0 || stored.size > MAX_DOC_BYTES)
    throw new AppError(
      "VALIDATION",
      "The upload didn’t finish. Please try again.",
    );
  await tx
    .update(file)
    .set({ status: "ready", byteSize: stored.size })
    .where(and(eq(file.businessId, tx.businessId), eq(file.id, f.id)));
  const [row] = await tx
    .insert(document)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      kind: "upload",
      category: input.category,
      title: input.title.trim() || categoryLabel(input.category),
      fileId: f.id,
    })
    .returning({ id: document.id });
  await recordActivity(tx, {
    kind: "document.filed",
    subjectType: "customer",
    subjectId: input.customerId,
    summary: `${input.jobId ? "File added to job" : "Attachment added"}: ${input.title.trim() || categoryLabel(input.category)}`,
    data: {
      documentId: row.id,
      ...(input.jobId ? { jobId: input.jobId } : {}),
    },
  });
  void meta;
  return { id: row.id };
}

export async function removeDocument(tx: TenantTx, documentId: string) {
  const [d] = await tx
    .update(document)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.id, documentId),
        eq(document.kind, "upload"),
      ),
    )
    .returning({ id: document.id });
  if (!d) throw notFound("That file");
  return { id: d.id };
}

// ---------------------------------------------------------------- listing

export async function listAttachments(tx: TenantTx, customerId: string) {
  return tx
    .select()
    .from(document)
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.customerId, customerId),
        isNull(document.jobId),
        isNull(document.deletedAt),
      ),
    )
    .orderBy(desc(document.createdAt));
}

export type CabinetItem = {
  id: string;
  group: "Created for this job" | "Signed & sent" | "Added files";
  title: string;
  detail: string;
  at: Date;
  status: string | null;
  href: string | null;
  documentId?: string;
  signLink?: string;
  estimateShareId?: string;
};

// Everything for one job: estimates, signed approvals, invoices, e-sign
// documents and uploaded files.
export async function jobCabinet(
  tx: TenantTx,
  jobId: string,
  unseal: (cipher: string | null) => string | null,
): Promise<CabinetItem[]> {
  const items: CabinetItem[] = [];
  const versions = await tx
    .select({ v: estimateVersion, a: estimateAuthorization })
    .from(estimateVersion)
    .leftJoin(
      estimateAuthorization,
      and(
        eq(estimateAuthorization.businessId, estimateVersion.businessId),
        eq(estimateAuthorization.versionId, estimateVersion.id),
      ),
    )
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, jobId),
      ),
    )
    .orderBy(desc(estimateVersion.version));
  for (const { v, a } of versions) {
    items.push({
      id: `est-${v.id}`,
      group: "Created for this job",
      title: `Estimate · version ${v.version}`,
      detail: money(v.snapshot.totalCents),
      at: v.createdAt,
      status: a ? "Signed" : v.revokedAt ? "Replaced" : "Sent",
      href: `/app/estimates?jobId=${jobId}`,
      estimateShareId:
        !a &&
        !v.revokedAt &&
        v.expiresAt > new Date() &&
        v.id === versions[0]?.v.id
          ? v.id
          : undefined,
    });
    if (a)
      items.push({
        id: `auth-${a.id}`,
        group: "Created for this job",
        title: `Signed approval · version ${v.version}`,
        detail: `Signed by ${a.signerName}`,
        at: a.createdAt,
        status: "Signed",
        href: `/app/estimates/${v.id}/authorization.pdf`,
      });
  }
  const invoices = await tx
    .select()
    .from(invoice)
    .where(
      and(eq(invoice.businessId, tx.businessId), eq(invoice.quoteId, jobId)),
    )
    .orderBy(desc(invoice.createdAt));
  for (const i of invoices)
    items.push({
      id: `inv-${i.id}`,
      group: "Created for this job",
      title: `Invoice #${i.number}`,
      detail: money(i.totalCents),
      at: i.createdAt,
      status: i.voidedAt ? "Void" : null,
      href: `/app/invoices?invoiceId=${i.id}`,
    });
  const docs = await tx
    .select()
    .from(document)
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.jobId, jobId),
        isNull(document.deletedAt),
      ),
    )
    .orderBy(desc(document.createdAt));
  for (const d of docs) {
    if (d.kind === "esign") {
      const token = d.status === "sent" ? unseal(d.shareTokenCiphertext) : null;
      items.push({
        id: d.id,
        group: "Signed & sent",
        title: d.title,
        detail:
          d.status === "signed"
            ? `Signed by ${d.signerName}`
            : d.status === "void"
              ? `Void: ${d.voidReason ?? ""}`
              : d.expiresAt && d.expiresAt <= new Date()
                ? "Link expired"
                : "Waiting for signature",
        at: d.signedAt ?? d.createdAt,
        status:
          d.status === "signed"
            ? "Signed"
            : d.status === "void"
              ? "Void"
              : "Waiting",
        href: d.status === "signed" ? `/app/documents/${d.id}/pdf` : null,
        documentId: d.id,
        signLink: token ? `/sign/${token}` : undefined,
      });
    } else
      items.push({
        id: d.id,
        group: "Added files",
        title: d.title,
        detail: categoryLabel(d.category),
        at: d.createdAt,
        status: null,
        href: `/media/${d.fileId}`,
        documentId: d.id,
      });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// Signed copy for the shop.
export async function shopDocumentPdf(tx: TenantTx, documentId: string) {
  const [d] = await tx
    .select({
      pdf: document.evidencePdfBase64,
      title: document.title,
    })
    .from(document)
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.id, documentId),
        eq(document.status, "signed"),
      ),
    );
  return d?.pdf ? { pdf: Buffer.from(d.pdf, "base64"), title: d.title } : null;
}

// ---------------------------------------------------------------- customer link

export type PublicDocument = {
  id: string;
  title: string;
  body: string;
  fields: DocumentField[];
  status: "sent" | "signed";
  expiresAt: string;
  shopName: string;
  signerName: string | null;
  signedAt: string | null;
  values: Record<string, string | boolean> | null;
};

export async function readPublicDocument(
  token: string,
): Promise<PublicDocument | null> {
  if (!isWellFormedToken(token)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select app.read_document(${hashToken(token)}) as data`,
    );
    return (r.rows[0]?.data ?? null) as PublicDocument | null;
  });
}

export function unsafeCustomerPricedChangeOrder(
  doc: Pick<PublicDocument, "title" | "fields">,
) {
  return (
    doc.title.trim().toLowerCase() === "change order" &&
    doc.fields.some((field) =>
      ["change", "added_cost", "cost", "price", "amount"].includes(field.key),
    )
  );
}

export function checkValues(
  fields: DocumentField[],
  raw: Record<string, unknown>,
) {
  const values: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = raw[f.key];
    if (f.type === "checkbox") {
      const on = v === true || v === "on" || v === "true";
      if (f.required && !on)
        throw new AppError("VALIDATION", `Please check: ${f.label}`);
      values[f.key] = on;
    } else {
      const s = typeof v === "string" ? v.trim().slice(0, 500) : "";
      if (f.required && !s)
        throw new AppError("VALIDATION", `Please fill in: ${f.label}`);
      if (f.type === "date" && s && !/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw new AppError("VALIDATION", `Enter a date for: ${f.label}`);
      values[f.key] = s;
    }
  }
  return values;
}

async function documentPdf(input: {
  doc: PublicDocument;
  name: string;
  values: Record<string, string | boolean>;
  signature: SignatureStrokes;
  meta: RequestMeta & { userAgent?: string | null };
  signedAt: string;
  bodySha: string;
}) {
  const { doc: d, name, values, signature, meta, signedAt, bodySha } = input;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(`${process.cwd()}/src/assets/authorization-font.ttf`),
    { subset: true },
  );
  let page = pdf.addPage([612, 792]);
  let y = 744;
  const text = (value: string, size = 10) => {
    for (const paragraph of value.split("\n")) {
      let line = "";
      const flush = () => {
        if (y < 48) {
          page = pdf.addPage([612, 792]);
          y = 744;
        }
        page.drawText(line, { x: 48, y, size, font });
        y -= size + 6;
        line = "";
      };
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, size) > 516) flush();
        line += char;
      }
      flush();
    }
  };
  text(d.shopName, 14);
  text(d.title, 12);
  text(d.body);
  text(" ");
  for (const f of d.fields)
    text(
      `${f.label}: ${f.type === "checkbox" ? (values[f.key] ? "Yes" : "No") : values[f.key] || "—"}`,
    );
  text(" ");
  text(`Signed by ${name.trim()} at ${signedAt}`);
  text(`IP: ${meta.ip ?? "unavailable"}`);
  text(`Browser/device: ${meta.userAgent ?? "unavailable"}`);
  text(`Request: ${meta.requestId}`);
  text(`Document SHA-256: ${bodySha}`);
  if (y < 240) {
    page = pdf.addPage([612, 792]);
    y = 744;
  }
  text("Drawn signature:");
  for (const stroke of signature)
    for (let i = 1; i < stroke.length; i++)
      page.drawLine({
        start: { x: 48 + stroke[i - 1].x * 480, y: y - stroke[i - 1].y * 180 },
        end: { x: 48 + stroke[i].x * 480, y: y - stroke[i].y * 180 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
  await pdf.attach(
    Buffer.from(JSON.stringify(input)),
    "signature-evidence.json",
    {
      mimeType: "application/json",
      description:
        "Exact document text, entries, signature and request evidence",
    },
  );
  return Buffer.from(await pdf.save());
}

export async function signDocument(
  token: string,
  raw: { name: string; values: Record<string, unknown>; signature: unknown },
  meta: RequestMeta & { userAgent?: string | null },
) {
  const doc = await readPublicDocument(token);
  if (!doc || doc.status !== "sent") throw notFound("That document");
  if (unsafeCustomerPricedChangeOrder(doc))
    throw new AppError(
      "VALIDATION",
      "This older change order needs to be replaced by a shop-prepared version before it can be signed.",
    );
  const name = raw.name?.trim() ?? "";
  if (name.length < 2) throw new AppError("VALIDATION", "Type your full name.");
  const signature = signatureSchema.safeParse(raw.signature);
  if (!signature.success)
    throw new AppError("VALIDATION", "Draw your signature in the box.");
  const values = checkValues(doc.fields, raw.values ?? {});
  const signedAt = new Date().toISOString();
  const bodySha = createHash("sha256").update(doc.body, "utf8").digest("hex");
  const pdf = await documentPdf({
    doc,
    name,
    values,
    signature: signature.data,
    meta,
    signedAt,
    bodySha,
  });
  await runInContext(null, { type: "customer", id: null }, (tx) =>
    tx.execute(
      sql`select app.sign_document(${hashToken(token)},${name},${JSON.stringify(values)}::jsonb,${JSON.stringify(signature.data)}::jsonb,${meta.ip ?? null},${meta.userAgent ?? null},${meta.requestId},${bodySha},${signedAt}::timestamptz,${pdf.toString("base64")})`,
    ),
  );
  return { id: doc.id };
}

export async function readPublicDocumentPdf(token: string) {
  if (!isWellFormedToken(token)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select app.read_document_pdf(${hashToken(token)}) as pdf`,
    );
    const b64 = r.rows[0]?.pdf as string | null | undefined;
    return b64 ? Buffer.from(b64, "base64") : null;
  });
}
