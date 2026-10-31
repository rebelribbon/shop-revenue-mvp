import {
  bigint,
  boolean,
  foreignKey,
  integer,
  jsonb,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { invoice } from "./m4";
import { activity } from "./platform";
import { recoveryItem, recommendation } from "./m7";
import { estimateVersion } from "./m3";
export const estimateRecommendationLine = app.table(
  "estimate_recommendation_line",
  {
    ...tenantColumns(),
    versionId: uuid("version_id").notNull(),
    lineId: text("line_id").notNull(),
    recommendationId: uuid("recommendation_id").notNull(),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.versionId, t.lineId),
    foreignKey({
      columns: [t.businessId, t.versionId],
      foreignColumns: [estimateVersion.businessId, estimateVersion.id],
    }),
    foreignKey({
      columns: [t.businessId, t.recommendationId],
      foreignColumns: [recommendation.businessId, recommendation.id],
    }),
  ],
);
export const revenueAttribution = app.table(
  "revenue_attribution",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id").notNull(),
    revision: integer("revision").notNull().default(0),
    classification: text("classification").notNull().default("none"),
    amountCents: bigint("amount_cents", { mode: "number" })
      .notNull()
      .default(0),
    contactActivityId: uuid("contact_activity_id"),
    responseActivityId: uuid("response_activity_id"),
    recoveryItemId: uuid("recovery_item_id"),
    ruleCode: text("rule_code").notNull().default("NONE"),
    ruleVersion: text("rule_version").notNull(),
    excluded: boolean("excluded").notNull().default(false),
    decision: jsonb("decision").notNull(),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.invoiceId),
    foreignKey({
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoice.businessId, invoice.id],
    }),
    foreignKey({
      columns: [t.businessId, t.contactActivityId],
      foreignColumns: [activity.businessId, activity.id],
    }),
    foreignKey({
      columns: [t.businessId, t.responseActivityId],
      foreignColumns: [activity.businessId, activity.id],
    }),
    foreignKey({
      columns: [t.businessId, t.recoveryItemId],
      foreignColumns: [recoveryItem.businessId, recoveryItem.id],
    }),
  ],
);
export const revenueAttributionEvent = app.table(
  "revenue_attribution_event",
  {
    ...tenantColumns(),
    attributionId: uuid("attribution_id").notNull(),
    revision: integer("revision").notNull(),
    directDeltaCents: bigint("direct_delta_cents", {
      mode: "number",
    }).notNull(),
    influencedDeltaCents: bigint("influenced_delta_cents", {
      mode: "number",
    }).notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    ruleVersion: text("rule_version").notNull(),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.attributionId, t.revision),
    foreignKey({
      columns: [t.businessId, t.attributionId],
      foreignColumns: [revenueAttribution.businessId, revenueAttribution.id],
    }),
  ],
);
