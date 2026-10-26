import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    status: text("status").notNull().default("active"),
  },
  (t) => [
    unique("customer_business_id_id_key").on(t.businessId, t.id),
    index("customer_business_display_name_idx").on(t.businessId, sql`lower(${t.displayName})`),
    index("customer_business_phone_digits_idx").on(t.businessId, t.phoneDigits).where(sql`${t.phoneDigits} IS NOT NULL`),
    index("customer_business_email_idx").on(t.businessId, t.email).where(sql`${t.email} IS NOT NULL`),
    check("customer_status_check", sql`${t.status} IN ('active', 'archived')`),
    check("customer_name_check", sql`length(btrim(${t.firstName})) > 0 OR length(btrim(${t.lastName})) > 0`),
    check("customer_email_check", sql`${t.email} IS NULL OR ${t.email} = lower(btrim(${t.email}))`),
    check("customer_phone_e164_check", sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\+[1-9][0-9]{7,14}$'`),
    check("customer_phone_digits_check", sql`${t.phoneDigits} IS NULL OR ${t.phoneDigits} ~ '^[0-9]{7,15}$'`),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "customer_business_fk" }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id], name: "customer_created_by_fk" }),
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
    notes: text("notes"),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    unique("vehicle_business_id_id_key").on(t.businessId, t.id),
    index("vehicle_business_customer_idx").on(t.businessId, t.customerId),
    index("vehicle_business_plate_idx").on(t.businessId, t.plateNormalized).where(sql`${t.plateNormalized} IS NOT NULL`),
    index("vehicle_business_vin_last6_idx").on(t.businessId, t.vinLast6).where(sql`${t.vinLast6} IS NOT NULL`),
    uniqueIndex("vehicle_business_vin_unique_idx").on(t.businessId, t.vin).where(sql`${t.vin} IS NOT NULL`),
    check("vehicle_status_check", sql`${t.status} IN ('active', 'archived')`),
    check("vehicle_year_check", sql`${t.year} IS NULL OR ${t.year} BETWEEN 1886 AND 2200`),
    check("vehicle_vin_check", sql`${t.vin} IS NULL OR ${t.vin} ~ '^[A-HJ-NPR-Z0-9]{11,17}$'`),
    check("vehicle_vin_last6_check", sql`${t.vinLast6} IS NULL OR ${t.vinLast6} ~ '^[A-HJ-NPR-Z0-9]{6}$'`),
    check("vehicle_plate_normalized_check", sql`${t.plateNormalized} IS NULL OR ${t.plateNormalized} ~ '^[A-Z0-9]+$'`),
    check("vehicle_mileage_check", sql`${t.mileage} IS NULL OR ${t.mileage} BETWEEN 0 AND 3000000`),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "vehicle_business_fk" }),
    foreignKey({ columns: [t.businessId, t.customerId], foreignColumns: [customer.businessId, customer.id], name: "vehicle_customer_tenant_fk" }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id], name: "vehicle_created_by_fk" }),
  ],
);
