import { date, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
