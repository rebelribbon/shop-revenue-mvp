import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";

// A follow-up the shop writes itself ("Call Maria Friday about tires").
// Reminders made by follow-up rules live in recovery_item (migration 0032).
export const task = app.table("task", {
  ...tenantColumns(),
  customerId: uuid("customer_id"),
  jobId: uuid("job_id"),
  assignedUserId: uuid("assigned_user_id"),
  title: text("title").notNull(),
  dueOn: date("due_on").notNull(),
  doneAt: timestamp("done_at", { withTimezone: true }),
});

// Closing out the day's cash drawer (migration 0034).
export const registerClose = app.table("register_close", {
  ...tenantColumns(),
  day: date("day").notNull(),
  startingCashCents: bigint("starting_cash_cents", {
    mode: "number",
  }).notNull(),
  expectedCashCents: bigint("expected_cash_cents", {
    mode: "number",
  }).notNull(),
  countedCashCents: bigint("counted_cash_cents", { mode: "number" }).notNull(),
  takenCents: bigint("taken_cents", { mode: "number" }).notNull(),
  note: text("note"),
});

// A tech's clocked time on a job (migration 0035).
export const timeEntry = app.table("time_entry", {
  ...tenantColumns(),
  jobId: uuid("job_id").notNull(),
  userId: uuid("user_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// A report the owner built and saved (migration 0036).
export const savedReport = app.table("saved_report", {
  ...tenantColumns(),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// A job's inspection checklist (migration 0037).
export const inspection = app.table("inspection", {
  ...tenantColumns(),
  jobId: uuid("job_id").notNull(),
  items: jsonb("items").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// A customer's private link to their estimates, invoices and visits (0039).
export const customerPortal = app.table("customer_portal", {
  ...tenantColumns(),
  customerId: uuid("customer_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  shareTokenCiphertext: text("share_token_ciphertext").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Which tech is on a job (0040). user_id null = nobody yet.
export const jobAssignment = app.table("job_assignment", {
  ...tenantColumns(),
  jobId: uuid("job_id").notNull(),
  userId: uuid("user_id"),
});

// Parts catalog (0041). Quantities are in hundredths (1.5 qt = 150).
export const partItem = app.table("part_item", {
  ...tenantColumns(),
  name: text("name").notNull(),
  partNumber: text("part_number"),
  unitCostCents: bigint("unit_cost_cents", { mode: "number" }),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  onHandHundredths: bigint("on_hand_hundredths", { mode: "number" })
    .notNull()
    .default(0),
  reorderAtHundredths: bigint("reorder_at_hundredths", { mode: "number" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Every stock change, never edited.
export const stockMove = app.table("stock_move", {
  ...tenantColumns(),
  partItemId: uuid("part_item_id").notNull(),
  changeHundredths: bigint("change_hundredths", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  invoiceId: uuid("invoice_id"),
  counterSaleId: uuid("counter_sale_id"),
  note: text("note"),
});

// Payment reminder emails sent for an invoice (0042).
export const paymentReminder = app.table("payment_reminder", {
  ...tenantColumns(),
  invoiceId: uuid("invoice_id").notNull(),
  sentTo: text("sent_to").notNull(),
  status: text("status").notNull(),
  automatic: boolean("automatic").notNull(),
  providerMessageId: text("provider_message_id"),
});

// Review request emails (0043).
export const reviewRequest = app.table("review_request", {
  ...tenantColumns(),
  customerId: uuid("customer_id").notNull(),
  invoiceId: uuid("invoice_id"),
  sentTo: text("sent_to").notNull(),
  status: text("status").notNull(),
  automatic: boolean("automatic").notNull(),
  providerMessageId: text("provider_message_id"),
});

// Monday summary emails sent (0044).
export const weeklyReport = app.table("weekly_report", {
  ...tenantColumns(),
  weekStart: date("week_start", { mode: "string" }).notNull(),
  sentTo: text("sent_to").notNull(),
  status: text("status").notNull(),
  automatic: boolean("automatic").notNull(),
});

// Quick sale at the counter (0047). Lines: { partItemId?, description,
// quantityHundredths, unitPriceCents, unitCostCents, taxable }.
export const counterSale = app.table("counter_sale", {
  ...tenantColumns(),
  number: integer("number").notNull(),
  lines: jsonb("lines").notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  taxBps: integer("tax_bps").notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  receivedCents: bigint("received_cents", { mode: "number" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: uuid("voided_by_user_id"),
  voidReason: text("void_reason"),
});
