import {
  bigint,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import type { Repeat } from "@/lib/service-plans";

// A recurring agreement started from one signed estimate (migration 0027).
export const servicePlan = app.table(
  "service_plan",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    serviceAssetId: uuid("service_asset_id"),
    quoteId: uuid("quote_id").notNull(),
    versionId: uuid("version_id").notNull(),
    authorizationId: uuid("authorization_id").notNull(),
    title: text("title").notNull(),
    repeat: jsonb("repeat").$type<Repeat>().notNull(),
    perVisitCents: bigint("per_visit_cents", { mode: "number" }).notNull(),
    billing: text("billing").$type<"per_visit" | "monthly">().notNull(),
    status: text("status")
      .$type<"active" | "paused" | "ended">()
      .notNull()
      .default("active"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
  },
  (t) => [unique().on(t.businessId, t.id)],
);
