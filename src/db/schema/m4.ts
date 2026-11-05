import {
  bigint,
  date,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import {
  estimateAuthorization,
  estimateVersion,
  type EstimateSnapshot,
} from "./m3";
import { asset, vehicle } from "./m2";
export type InvoiceSnapshot = EstimateSnapshot & {
  shopPhone?: string | null;
  shopAddress?: string;
};
export const invoice = app.table(
  "invoice",
  {
    ...tenantColumns(),
    number: integer("number").notNull(),
    quoteId: uuid("quote_id").notNull(),
    versionId: uuid("version_id").notNull(),
    authorizationId: uuid("authorization_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    serviceAssetId: uuid("service_asset_id"),
    snapshot: jsonb("snapshot").$type<InvoiceSnapshot>().notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    dueOn: date("due_on"),
    invoiceTerms: text("invoice_terms").notNull().default(""),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    disputeOpen: text("dispute_open"),
    // Set when a service plan billed this invoice (many per job).
    servicePlanId: uuid("service_plan_id"),
    // Add-on invoice for supplement work: the job's main invoice (0049).
    supplementOf: uuid("supplement_of"),
    // This invoice's layout override, on top of the business default.
    display: jsonb("display"),
    tokenHash: text("token_hash").notNull(),
    shareTokenCiphertext: text("share_token_ciphertext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.businessId, t.customerId, t.serviceAssetId],
      foreignColumns: [asset.businessId, asset.customerId, asset.id],
    }),
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.number),
    foreignKey({
      columns: [t.businessId, t.quoteId, t.versionId],
      foreignColumns: [
        estimateVersion.businessId,
        estimateVersion.quoteId,
        estimateVersion.id,
      ],
    }),
    foreignKey({
      columns: [t.businessId, t.versionId, t.authorizationId],
      foreignColumns: [
        estimateAuthorization.businessId,
        estimateAuthorization.versionId,
        estimateAuthorization.id,
      ],
    }),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
    }),
  ],
);
export const invoicePayment = app.table(
  "invoice_payment",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: text("method").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeRefundId: text("stripe_refund_id"),
    stripeAccountId: text("stripe_account_id"),
    checkoutId: uuid("checkout_id"),
    reference: text("reference").notNull().default(""),
    reversesPaymentId: uuid("reverses_payment_id"),
    reason: text("reason"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.invoiceId, t.id),
    foreignKey({
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoice.businessId, invoice.id],
    }),
  ],
);
