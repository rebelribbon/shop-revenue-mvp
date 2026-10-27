import {
  bigint,
  boolean,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { invoice, invoicePayment } from "./m4";
export const stripeConnection = app.table(
  "stripe_connection",
  {
    ...tenantColumns(),
    accountId: text("account_id"),
    cardPaymentsStatus: text("card_payments_status")
      .notNull()
      .default("not_connected"),
    livemode: boolean("livemode").notNull().default(false),
  },
  (t) => [unique().on(t.businessId), unique().on(t.accountId)],
);
export const invoiceCheckout = app.table(
  "invoice_checkout",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    accountId: text("account_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status").notNull().default("creating"),
    sessionId: text("session_id"),
    paymentIntentId: text("payment_intent_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoice.businessId, invoice.id],
    }),
  ],
);
export const invoiceRefund = app.table(
  "invoice_refund",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("creating"),
    stripeRefundId: text("stripe_refund_id"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.invoiceId, t.paymentId],
      foreignColumns: [
        invoicePayment.businessId,
        invoicePayment.invoiceId,
        invoicePayment.id,
      ],
    }),
  ],
);
