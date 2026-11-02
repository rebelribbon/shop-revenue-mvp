import { jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";

// A blank the customer fills in on an e-sign document.
export type DocumentField = {
  key: string;
  label: string;
  type: "text" | "date" | "checkbox" | "initials";
  required: boolean;
};

export const documentTemplate = app.table("document_template", {
  ...tenantColumns(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  fields: jsonb("fields").$type<DocumentField[]>().notNull().default([]),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Customer attachments and the job file cabinet (migration 0031).
export const document = app.table("document", {
  ...tenantColumns(),
  customerId: uuid("customer_id").notNull(),
  jobId: uuid("job_id"),
  kind: text("kind").$type<"upload" | "esign">().notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  fileId: uuid("file_id"),
  templateId: uuid("template_id"),
  body: text("body"),
  fields: jsonb("fields").$type<DocumentField[]>(),
  tokenHash: text("token_hash"),
  shareTokenCiphertext: text("share_token_ciphertext"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status")
    .$type<"filed" | "sent" | "signed" | "void">()
    .notNull()
    .default("filed"),
  bodySha256: text("body_sha256"),
  values: jsonb("values").$type<Record<string, string | boolean>>(),
  signerName: text("signer_name"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  signatureStrokes: jsonb("signature_strokes"),
  evidencePdfBase64: text("evidence_pdf_base64"),
  evidencePdfSha256: text("evidence_pdf_sha256"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
