import {
  bigint,
  date,
  foreignKey,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { asset, customer, vehicle } from "./m2";
import { estimateVersion } from "./m3";

export const recommendation = app.table(
  "recommendation",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    description: text("description").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    declinedAt: timestamp("declined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("open"),
    sourceVersionId: uuid("source_version_id"),
    sourceLineId: text("source_line_id"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
    }),
    foreignKey({
      columns: [t.businessId, t.sourceVersionId],
      foreignColumns: [estimateVersion.businessId, estimateVersion.id],
    }),
  ],
);

export const recoveryItem = app.table(
  "recovery_item",
  {
    ...tenantColumns(),
    category: text("category").notNull(),
    subjectId: uuid("subject_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    serviceAssetId: uuid("service_asset_id"),
    status: text("status").notNull().default("open"),
    snoozedUntil: date("snoozed_until"),
    dismissedReason: text("dismissed_reason"),
    dismissedRecommendationIds: jsonb("dismissed_recommendation_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastContactMethod: text("last_contact_method"),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.category, t.subjectId),
    foreignKey({
      columns: [t.businessId, t.customerId, t.serviceAssetId],
      foreignColumns: [asset.businessId, asset.customerId, asset.id],
    }),
    foreignKey({
      columns: [t.businessId, t.customerId],
      foreignColumns: [customer.businessId, customer.id],
    }),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
    }),
  ],
);
