import { sql } from "drizzle-orm";
import {
  boolean,
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
import { app, E164_CHECK, id, tenantColumns, timestamps } from "./common";

// business (global root; is the tenant). Section 7.
export const business = app.table(
  "business",
  {
    id: id(),
    legalName: text("legal_name").notNull(),
    businessType: text("business_type").notNull().default("automotive"),
    businessTypeSelected: boolean("business_type_selected")
      .notNull()
      .default(false),
    dba: text("dba"),
    phoneE164: text("phone_e164"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    timezone: text("timezone").notNull().default("America/Chicago"),
    jurisdictionCode: text("jurisdiction_code").notNull().default("US-TX"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    // The owner confirms they chose the rate; reset whenever the rate changes.
    taxRateConfirmedAt: timestamp("tax_rate_confirmed_at", {
      withTimezone: true,
    }),
    taxRateConfirmedBy: uuid("tax_rate_confirmed_by"),
    laborSellRateCents: integer("labor_sell_rate_cents").notNull().default(0),
    laborCostRateCents: integer("labor_cost_rate_cents").notNull().default(0),
    partsTaxableDefault: boolean("parts_taxable_default")
      .notNull()
      .default(true),
    laborTaxableDefault: boolean("labor_taxable_default")
      .notNull()
      .default(false),
    // FK to file (business_id, id) is added in hand-written SQL (circular reference).
    logoFileId: uuid("logo_file_id"),
    // Default invoice layout (src/lib/invoice-display.ts).
    invoiceDisplay: jsonb("invoice_display"),
    // Which follow-up reminders run, and when (src/lib/follow-up-rules.ts).
    followUpRules: jsonb("follow_up_rules").notNull().default({}),
    // Automatic payment reminders (0042): { on, everyDays }.
    paymentReminders: jsonb("payment_reminders").notNull().default({}),
    // Review requests (0043): { on, link }.
    reviewRequests: jsonb("review_requests").notNull().default({}),
    // Monday summary email (0044): { on } — on unless turned off.
    weeklyReport: jsonb("weekly_report").notNull().default({}),
    // Deposits (0048): { on, overCents, percent }.
    deposits: jsonb("deposits").notNull().default({}),
    // Public "Book online" link (/book/<slug>); null = turned off.
    bookingSlug: text("booking_slug"),
    // Profit the shop aims for on a job, in basis points (4000 = 40%).
    targetMarginBps: integer("target_margin_bps").notNull().default(4000),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    check(
      "business_status_check",
      sql`${t.status} IN ('active', 'suspended', 'closed')`,
    ),
    check(
      "business_tax_rate_bps_check",
      sql`${t.taxRateBps} BETWEEN 0 AND 2000`,
    ),
    check("business_phone_e164_check", sql`${t.phoneE164} ~ ${E164_CHECK}`),
    check("business_legal_name_check", sql`length(btrim(${t.legalName})) > 0`),
  ],
);

// user (global): a login identity, mapped from Supabase Auth.
export const user = app.table(
  "user",
  {
    id: id(),
    authProviderId: uuid("auth_provider_id").notNull(),
    email: text("email"),
    phoneE164: text("phone_e164"),
    displayName: text("display_name").notNull(),
    mfaPhoneE164: text("mfa_phone_e164"),
    status: text("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("user_auth_provider_id_key").on(t.authProviderId),
    unique("user_email_key").on(t.email),
    unique("user_phone_e164_key").on(t.phoneE164),
    check("user_status_check", sql`${t.status} IN ('active', 'deactivated')`),
    check("user_email_check", sql`${t.email} = lower(btrim(${t.email}))`),
    check("user_phone_e164_check", sql`${t.phoneE164} ~ ${E164_CHECK}`),
    check("user_mfa_phone_e164_check", sql`${t.mfaPhoneE164} ~ ${E164_CHECK}`),
  ],
);

// location (tenant): structural only (D4); one default row per business.
export const location = app.table(
  "location",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [
    unique("location_business_id_id_key").on(t.businessId, t.id),
    uniqueIndex("location_one_default_idx")
      .on(t.businessId)
      .where(sql`${t.isDefault}`),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "location_business_fk",
    }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "location_created_by_fk",
    }),
  ],
);

// membership (tenant): user <-> business with role. An invited membership has no
// user until acceptInvite; the invite token is stored only as a SHA-256 hash.
export const membership = app.table(
  "membership",
  {
    ...tenantColumns(),
    userId: uuid("user_id"),
    role: text("role").notNull(),
    status: text("status").notNull(),
    inviteName: text("invite_name"),
    inviteEmail: text("invite_email"),
    invitePhoneE164: text("invite_phone_e164"),
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    unique("membership_business_id_id_key").on(t.businessId, t.id),
    unique("membership_business_id_user_id_key").on(t.businessId, t.userId),
    unique("membership_invite_token_hash_key").on(t.inviteTokenHash),
    uniqueIndex("membership_one_active_owner_idx")
      .on(t.businessId)
      .where(sql`${t.role} = 'owner' AND ${t.status} = 'active'`),
    // Staff seats (invited or active) are capped by app.membership_guard
    // (migration 0024), which replaced the original one-seat unique index.
    index("membership_user_id_idx").on(t.userId),
    check("membership_role_check", sql`${t.role} IN ('owner', 'staff')`),
    check(
      "membership_status_check",
      sql`${t.status} IN ('invited', 'active', 'removed')`,
    ),
    // A pending invite has no user yet and can be revoked (invited -> removed) without one.
    check(
      "membership_user_required_check",
      sql`${t.status} <> 'active' OR ${t.userId} IS NOT NULL`,
    ),
    check(
      "membership_invite_contact_check",
      sql`${t.status} <> 'invited' OR ${t.inviteEmail} IS NOT NULL OR ${t.invitePhoneE164} IS NOT NULL`,
    ),
    check(
      "membership_invite_email_check",
      sql`${t.inviteEmail} = lower(btrim(${t.inviteEmail}))`,
    ),
    check(
      "membership_invite_phone_e164_check",
      sql`${t.invitePhoneE164} ~ ${E164_CHECK}`,
    ),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "membership_business_fk",
    }),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [user.id],
      name: "membership_user_fk",
    }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "membership_created_by_fk",
    }),
  ],
);

// internal_user (global): our staff for /admin. Never readable by app_user.
export const internalUser = app.table(
  "internal_user",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    authProviderId: uuid("auth_provider_id"),
    ...timestamps(),
  },
  (t) => [
    unique("internal_user_email_key").on(t.email),
    unique("internal_user_auth_provider_id_key").on(t.authProviderId),
    check("internal_user_role_check", sql`${t.role} IN ('support', 'admin')`),
    check(
      "internal_user_email_check",
      sql`${t.email} = lower(btrim(${t.email}))`,
    ),
  ],
);

// support_session (global, carries business_id): view-as record. RLS forced with
// role-specific policies so the Section 9 CI rule holds (see docs/m1-report.md).
export const supportSession = app.table(
  "support_session",
  {
    id: id(),
    adminUserId: uuid("admin_user_id").notNull(),
    // Snapshot of the internal user's name: the shop's access log (S29) must say
    // who accessed the account, and the shop can never read internal_user.
    adminDisplayName: text("admin_display_name").notNull(),
    businessId: uuid("business_id").notNull(),
    reason: text("reason").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    ...timestamps(),
  },
  (t) => [
    index("support_session_business_started_idx").on(t.businessId, t.startedAt),
    // Target of tenant-composite references (audit_event.support_session_id).
    unique("support_session_business_id_id_key").on(t.businessId, t.id),
    check(
      "support_session_reason_check",
      sql`length(btrim(${t.reason})) >= 10`,
    ),
    check(
      "support_session_duration_check",
      sql`${t.expiresAt} = ${t.startedAt} + interval '60 minutes'`,
    ),
    check(
      "support_session_end_check",
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    check(
      "support_session_end_reason_check",
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL) AND (${t.endReason} IS NULL OR ${t.endReason} IN ('ended', 'expired'))`,
    ),
    foreignKey({
      columns: [t.adminUserId],
      foreignColumns: [internalUser.id],
      name: "support_session_admin_fk",
    }),
    foreignKey({
      columns: [t.businessId],
      foreignColumns: [business.id],
      name: "support_session_business_fk",
    }),
  ],
);
