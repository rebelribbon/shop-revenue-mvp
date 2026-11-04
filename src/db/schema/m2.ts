import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { business, user } from "./tenancy";

export const customer = app.table(
  "customer",
  {
    ...tenantColumns(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phoneE164: text("phone_e164"),
    phoneDigits: text("phone_digits"),
    notes: text("notes"),
    // Mailing / billing address (migration 0031).
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    // Null = allowed. Set when the customer asks to stop (e.g. replies STOP).
    textOptedOutAt: timestamp("text_opted_out_at", { withTimezone: true }),
    emailOptedOutAt: timestamp("email_opted_out_at", { withTimezone: true }),
    // Where they found the shop (0045).
    leadSource: text("lead_source"),
    leadSourceDetail: text("lead_source_detail"),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    unique("customer_business_id_id_key").on(t.businessId, t.id),
    index("customer_business_display_name_idx").on(
      t.businessId,
      sql`lower(${t.displayName})`,
    ),
    index("customer_business_phone_digits_idx")
      .on(t.businessId, t.phoneDigits)
      .where(sql`${t.phoneDigits} IS NOT NULL`),
    index("customer_business_email_idx")
      .on(t.businessId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
    check("customer_status_check", sql`${t.status} IN ('active', 'archived')`),
    check(
      "customer_name_check",
      sql`length(btrim(${t.firstName})) > 0 OR length(btrim(${t.lastName})) > 0`,
    ),
    check(
      "customer_email_check",
      sql`${t.email} IS NULL OR ${t.email} = lower(btrim(${t.email}))`,
    ),
    check(
      "customer_phone_e164_check",
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      "customer_phone_digits_check",
      sql`${t.phoneDigits} IS NULL OR ${t.phoneDigits} ~ '^[0-9]{7,15}$'`,
    ),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "customer_business_fk",
    }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "customer_created_by_fk",
    }),
  ],
);

export const asset = app.table(
  "asset",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    type: text("type").notNull().default("vehicle"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    nextServiceOn: date("next_service_on"),
    nextServiceDescription: text("next_service_description"),
    nextServiceAmountCents: integer("next_service_amount_cents"),
    parentAssetId: uuid("parent_asset_id"),
    details: jsonb("details")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (t) => [
    unique("asset_business_id_id_key").on(t.businessId, t.id),
    unique("asset_business_customer_id_key").on(
      t.businessId,
      t.customerId,
      t.id,
    ),
    foreignKey({
      columns: [t.businessId, t.customerId, t.parentAssetId],
      foreignColumns: [t.businessId, t.customerId, t.id],
    }),
    foreignKey({
      columns: [t.businessId, t.customerId],
      foreignColumns: [customer.businessId, customer.id],
    }),
    index("asset_customer_idx").on(t.businessId, t.customerId),
  ],
);

export const vehicle = app.table(
  "vehicle",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    year: integer("year"),
    make: text("make"),
    model: text("model"),
    trim: text("trim"),
    vin: text("vin"),
    vinLast6: text("vin_last6"),
    plate: text("plate"),
    plateNormalized: text("plate_normalized"),
    mileage: integer("mileage"),
    nextServiceOn: date("next_service_on"),
    nextServiceDescription: text("next_service_description"),
    nextServiceAmountCents: integer("next_service_amount_cents"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    unique("vehicle_business_id_id_key").on(t.businessId, t.id),
    unique("vehicle_business_customer_id_id_key").on(
      t.businessId,
      t.customerId,
      t.id,
    ),
    index("vehicle_business_customer_idx").on(t.businessId, t.customerId),
    index("vehicle_business_plate_idx")
      .on(t.businessId, t.plateNormalized)
      .where(sql`${t.plateNormalized} IS NOT NULL`),
    index("vehicle_business_vin_last6_idx")
      .on(t.businessId, t.vinLast6)
      .where(sql`${t.vinLast6} IS NOT NULL`),
    uniqueIndex("vehicle_business_vin_unique_idx")
      .on(t.businessId, t.vin)
      .where(sql`${t.vin} IS NOT NULL`),
    check("vehicle_status_check", sql`${t.status} IN ('active', 'archived')`),
    check(
      "vehicle_year_check",
      sql`${t.year} IS NULL OR ${t.year} BETWEEN 1886 AND 2200`,
    ),
    check(
      "vehicle_vin_check",
      sql`${t.vin} IS NULL OR ${t.vin} ~ '^[A-HJ-NPR-Z0-9]{11,17}$'`,
    ),
    check(
      "vehicle_vin_last6_check",
      sql`${t.vinLast6} IS NULL OR ${t.vinLast6} ~ '^[A-HJ-NPR-Z0-9]{6}$'`,
    ),
    check(
      "vehicle_plate_normalized_check",
      sql`${t.plateNormalized} IS NULL OR ${t.plateNormalized} ~ '^[A-Z0-9]+$'`,
    ),
    check(
      "vehicle_mileage_check",
      sql`${t.mileage} IS NULL OR ${t.mileage} BETWEEN 0 AND 3000000`,
    ),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "vehicle_business_fk",
    }),
    foreignKey({
      columns: [t.businessId, t.id],
      foreignColumns: [asset.businessId, asset.id],
      name: "vehicle_asset_tenant_fk",
    }),
    foreignKey({
      columns: [t.businessId, t.customerId],
      foreignColumns: [customer.businessId, customer.id],
      name: "vehicle_customer_tenant_fk",
    }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "vehicle_created_by_fk",
    }),
  ],
);

export const appointment = app.table(
  "appointment",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    serviceAssetId: uuid("service_asset_id"),
    sourceRecoveryItemId: uuid("source_recovery_item_id"),
    sourceContactActivityId: uuid("source_contact_activity_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    reason: text("reason"),
    notes: text("notes"),
    status: text("status").notNull().default("scheduled"),
    // Recurring visits (migration 0027): the plan, its calendar day, and the
    // invoice that billed this visit.
    servicePlanId: uuid("service_plan_id"),
    planVisitOn: date("plan_visit_on", { mode: "string" }),
    planInvoiceId: uuid("plan_invoice_id"),
    // The tech on this visit (migration 0040).
    assignedUserId: uuid("assigned_user_id"),
  },
  (t) => [
    unique("appointment_business_id_id_key").on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.customerId, t.serviceAssetId],
      foreignColumns: [asset.businessId, asset.customerId, asset.id],
    }),
    index("appointment_business_starts_idx").on(t.businessId, t.startsAt),
    index("appointment_business_customer_starts_idx").on(
      t.businessId,
      t.customerId,
      t.startsAt,
    ),
    check(
      "appointment_status_check",
      sql`${t.status} IN ('scheduled', 'completed', 'cancelled', 'no_show')`,
    ),
    check(
      "appointment_time_check",
      sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
    check(
      "appointment_reason_check",
      sql`${t.reason} IS NULL OR length(btrim(${t.reason})) > 0`,
    ),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "appointment_business_fk",
    }),
    foreignKey({
      columns: [t.businessId, t.customerId],
      foreignColumns: [customer.businessId, customer.id],
      name: "appointment_customer_tenant_fk",
    }),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
      name: "appointment_vehicle_customer_tenant_fk",
    }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "appointment_created_by_fk",
    }),
  ],
);

export const assetReading = app.table(
  "asset_reading",
  {
    ...tenantColumns(),
    assetId: uuid("asset_id").notNull(),
    readingType: text("reading_type").notNull().default("odometer"),
    value: integer("value").notNull(),
    unit: text("unit").notNull().default("mi"),
    readOn: timestamp("read_on", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("manual"),
  },
  (t) => [
    unique("asset_reading_business_id_id_key").on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.assetId],
      foreignColumns: [asset.businessId, asset.id],
    }),
    index("asset_reading_history_idx").on(
      t.businessId,
      t.assetId,
      t.readOn,
      t.id,
    ),
  ],
);

export const note = app.table(
  "note",
  {
    ...tenantColumns(),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // "profile" notes are pinned to the customer; "log" notes are history.
    kind: text("kind").$type<"profile" | "log">().notNull().default("log"),
    headsUp: boolean("heads_up").notNull().default(false),
    jobId: uuid("job_id"),
  },
  (t) => [
    unique("note_business_id_id_key").on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.customerId],
      foreignColumns: [customer.businessId, customer.id],
    }),
    foreignKey({
      columns: [t.businessId, t.customerId, t.vehicleId],
      foreignColumns: [vehicle.businessId, vehicle.customerId, vehicle.id],
    }),
    index("note_customer_idx").on(t.businessId, t.customerId, t.createdAt),
  ],
);

export const vinDecodeCache = app.table("vin_decode_cache", {
  vin: text("vin").primaryKey(),
  payload: jsonb("payload")
    .$type<{
      year: number | null;
      make: string | null;
      model: string | null;
      trim: string | null;
    }>()
    .notNull(),
  decodedAt: timestamp("decoded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
