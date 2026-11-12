import type { Repeat } from "@/lib/service-plans";
import {
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { asset, vehicle } from "./m2";
export type EstimateLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  kind: "part" | "labor";
  taxable?: boolean;
  // Catalog part, so stock can come off when invoiced.
  partItemId?: string;
  // Work the shop recommends (from the inspection or declined before), shown
  // to the customer apart from what they came in for.
  recommended?: boolean;
};
// The technician's findings, frozen with the estimate for the customer.
export type EstimateInspection = {
  diagnosis: string;
  checkedCount: number;
  goodCount: number;
  findings: {
    label: string;
    section?: string;
    status: "watch" | "fix";
    note: string;
    recommendedWork: string;
    measurements?: Partial<Record<"lf" | "rf" | "lr" | "rr" | "spare", string>>;
  }[];
};
export type AuthorizationPolicy = {
  id: string;
  version: number;
  jurisdictionCode: string;
  body: string;
  bodySha256: string;
};
export type EstimateSnapshot = {
  title: string;
  shopName: string;
  customerName: string;
  vehicleLabel: string;
  serviceLabel?: string;
  lines: EstimateLine[];
  // Check-in: what the customer came in for and the odometer reading.
  concerns?: string;
  mileageIn?: number;
  inspection?: EstimateInspection;
  subtotalCents: number;
  taxBps: number;
  taxCents: number;
  totalCents: number;
  terms: string;
  // Warranty on the work, in months from the invoice date.
  warrantyMonths?: number;
  authorizationPolicy?: AuthorizationPolicy;
  // Recurring work the customer agreed to (one signature covers every visit).
  repeat?: Repeat;
  repeatSummary?: string;
  // Photos/videos the shop chose to show with this estimate.
  photos?: {
    fileId: string;
    mediaType: "photo" | "video";
    tag: string;
    caption: string | null;
  }[];
};
export const estimateVersion = app.table(
  "estimate_version",
  {
    ...tenantColumns(),
    quoteId: uuid("quote_id").notNull(),
    version: integer("version").notNull(),
    sourceRecoveryItemId: uuid("source_recovery_item_id"),
    sourceContactActivityId: uuid("source_contact_activity_id"),
    sourceAppointmentId: uuid("source_appointment_id"),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    serviceAssetId: uuid("service_asset_id"),
    snapshot: jsonb("snapshot").$type<EstimateSnapshot>().notNull(),
    supplementReason: text("supplement_reason"),
    tokenHash: text("token_hash").notNull(),
    shareTokenCiphertext: text("share_token_ciphertext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.businessId, t.customerId, t.serviceAssetId],
      foreignColumns: [asset.businessId, asset.customerId, asset.id],
    }),
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.quoteId, t.version),
    unique().on(t.businessId, t.quoteId, t.id),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
    }),
  ],
);
export const estimateAuthorization = app.table(
  "estimate_authorization",
  {
    ...tenantColumns(),
    versionId: uuid("version_id").notNull(),
    signerName: text("signer_name").notNull(),
    approvedLineIds: jsonb("approved_line_ids").$type<string[]>().notNull(),
    consentText: text("consent_text").notNull(),
    ip: text("ip"),
    requestId: text("request_id").notNull(),
    userAgent: text("user_agent"),
    estimateSha256: text("estimate_sha256"),
    policyId: uuid("policy_id"),
    policyVersion: integer("policy_version"),
    policySha256: text("policy_sha256"),
    lineDecisions:
      jsonb("line_decisions").$type<
        import("@/lib/estimate-decisions").LineDecision[]
      >(),
    signatureStrokes:
      jsonb("signature_strokes").$type<
        import("@/lib/estimate-decisions").SignatureStrokes
      >(),
    evidencePdfBase64: text("evidence_pdf_base64"),
    evidencePdfSha256: text("evidence_pdf_sha256"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.versionId],
      foreignColumns: [estimateVersion.businessId, estimateVersion.id],
    }),
    unique().on(t.businessId, t.versionId, t.id),
  ],
);

export const authorizationSummaryColumns = {
  id: estimateAuthorization.id,
  signerName: estimateAuthorization.signerName,
  approvedLineIds: estimateAuthorization.approvedLineIds,
  consentText: estimateAuthorization.consentText,
  createdAt: estimateAuthorization.createdAt,
  evidencePdfSha256: estimateAuthorization.evidencePdfSha256,
};
export type AuthorizationSummary = Pick<
  typeof estimateAuthorization.$inferSelect,
  keyof typeof authorizationSummaryColumns
>;
