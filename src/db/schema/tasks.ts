import { bigint, date, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";

// A follow-up the shop writes itself ("Call Maria Friday about tires").
// Reminders made by follow-up rules live in recovery_item (migration 0032).
export const task = app.table("task", {
  ...tenantColumns(),
  customerId: uuid("customer_id"),
  jobId: uuid("job_id"),
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
