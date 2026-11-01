import {
  bigint,
  boolean,
  date,
  foreignKey,
  jsonb,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import type { JobInput } from "@/domain/jobs";
export const expense = app.table(
  "expense",
  {
    ...tenantColumns(),
    spentOn: date("spent_on").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    includedInJobCost: boolean("included_in_job_cost").notNull().default(false),
    reversesExpenseId: uuid("reverses_expense_id"),
    reason: text("reason"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.reversesExpenseId],
      foreignColumns: [t.businessId, t.id],
    }),
  ],
);
export const commonJob = app.table(
  "common_job",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    parts: jsonb("parts").$type<JobInput["parts"]>().notNull(),
    labor: jsonb("labor").$type<JobInput["labor"]>().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique().on(t.businessId, t.id)],
);
