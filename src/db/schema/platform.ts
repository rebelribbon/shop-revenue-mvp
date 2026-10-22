import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, id, tenantColumns, timestamps } from "./common";
import { business, internalUser, supportSession, user } from "./tenancy";

// activity (tenant): customer timeline, append-only. customer_id and asset_id
// arrive with their tables in Milestone 2.
export const activity = app.table(
  "activity",
  {
    ...tenantColumns(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    summary: text("summary").notNull(),
    data: jsonb("data").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("activity_business_id_id_key").on(t.businessId, t.id),
    index("activity_business_occurred_idx").on(t.businessId, t.occurredAt.desc()),
    index("activity_business_subject_idx").on(t.businessId, t.subjectType, t.subjectId),
    check("activity_actor_type_check", sql`${t.actorType} IN ('user', 'customer', 'system', 'support')`),
    check("activity_kind_check", sql`${t.kind} ~ '^[a-z_]+\\.[a-z_]+$'`),
    check("activity_summary_check", sql`length(${t.summary}) <= 280`),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "activity_business_fk" }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id], name: "activity_created_by_fk" }),
  ],
);

// audit_event: security and money record, append-only. Spec issue 1: business_id
// is nullable only for platform-level actions by internal users or the system
// (for example approveLegalPolicy), which have no business. Tenant rows behave
// exactly like any tenant table under RLS; platform rows are invisible to app_user.
export const auditEvent = app.table(
  "audit_event",
  {
    id: id(),
    businessId: uuid("business_id"),
    ...timestamps(),
    createdByUserId: uuid("created_by_user_id"),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    requestId: text("request_id").notNull(),
    supportSessionId: uuid("support_session_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("audit_event_business_id_id_key").on(t.businessId, t.id),
    index("audit_event_business_occurred_idx").on(t.businessId, t.occurredAt),
    index("audit_event_target_idx").on(t.targetType, t.targetId),
    index("audit_event_request_idx").on(t.requestId),
    check(
      "audit_event_actor_type_check",
      sql`${t.actorType} IN ('user', 'customer', 'system', 'support', 'internal')`,
    ),
    check(
      "audit_event_platform_scope_check",
      sql`${t.businessId} IS NOT NULL OR ${t.actorType} IN ('internal', 'system')`,
    ),
    check("audit_event_action_check", sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "audit_event_business_fk" }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id], name: "audit_event_created_by_fk" }),
    foreignKey({
      columns: [t.supportSessionId],
      foreignColumns: [supportSession.id],
      name: "audit_event_support_session_fk",
    }),
  ],
);

// request_idempotency (tenant): stored responses for clientRequestId, kept 48 hours.
export const requestIdempotency = app.table(
  "request_idempotency",
  {
    ...tenantColumns(),
    clientRequestId: uuid("client_request_id").notNull(),
    action: text("action").notNull(),
    responseJson: jsonb("response_json").notNull(),
  },
  (t) => [
    unique("request_idempotency_business_id_id_key").on(t.businessId, t.id),
    unique("request_idempotency_client_request_key").on(t.businessId, t.clientRequestId),
    index("request_idempotency_created_idx").on(t.createdAt),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "request_idempotency_business_fk" }),
    foreignKey({
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
      name: "request_idempotency_created_by_fk",
    }),
  ],
);

// file (tenant): stored object metadata. Keys are b/{business_id}/{kind}/{yyyy}/{mm}/{file_id}.{ext}.
export const file = app.table(
  "file",
  {
    ...tenantColumns(),
    storageKey: text("storage_key").notNull(),
    kind: text("kind").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    status: text("status").notNull().default("pending"),
  },
  (t) => [
    unique("file_business_id_id_key").on(t.businessId, t.id),
    unique("file_storage_key_key").on(t.storageKey),
    check(
      "file_kind_check",
      sql`${t.kind} IN ('estimate_photo', 'signature', 'estimate_pdf', 'invoice_pdf', 'authorization_pdf', 'logo', 'import_source', 'export')`,
    ),
    check("file_status_check", sql`${t.status} IN ('pending', 'ready', 'quarantined')`),
    check("file_byte_size_check", sql`${t.byteSize} >= 0`),
    check("file_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "file_storage_key_prefix_check",
      sql`${t.storageKey} LIKE 'b/' || ${t.businessId}::text || '/' || ${t.kind} || '/%'`,
    ),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "file_business_fk" }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id], name: "file_created_by_fk" }),
  ],
);

// webhook_event (global inbox, carries business_id once resolved). Not readable
// by app_user; stored through app.ingest_webhook_event (SECURITY DEFINER).
export const webhookEvent = app.table(
  "webhook_event",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    businessId: uuid("business_id"),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("webhook_event_provider_event_key").on(t.provider, t.providerEventId),
    index("webhook_event_status_received_idx").on(t.status, t.receivedAt),
    index("webhook_event_business_received_idx").on(t.businessId, t.receivedAt),
    check("webhook_event_provider_check", sql`${t.provider} IN ('stripe', 'twilio', 'postmark')`),
    check(
      "webhook_event_status_check",
      sql`${t.status} IN ('received', 'processing', 'applied', 'ignored', 'failed', 'dead')`,
    ),
    check("webhook_event_attempts_check", sql`${t.attempts} BETWEEN 0 AND 8`),
    // Only signature-verified events are ever stored (invalid ones are rejected at the route).
    check("webhook_event_signature_check", sql`${t.signatureValid}`),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id], name: "webhook_event_business_fk" }),
  ],
);

// legal_policy (global): attorney-approved copy, versioned per jurisdiction.
export const legalPolicy = app.table(
  "legal_policy",
  {
    id: id(),
    jurisdictionCode: text("jurisdiction_code").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    status: text("status").notNull().default("draft"),
    createdByInternalUserId: uuid("created_by_internal_user_id").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalReference: text("approval_reference"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("legal_policy_version_key").on(t.jurisdictionCode, t.kind, t.version),
    uniqueIndex("legal_policy_one_approved_idx")
      .on(t.jurisdictionCode, t.kind)
      .where(sql`${t.status} = 'approved'`),
    check(
      "legal_policy_kind_check",
      sql`${t.kind} IN ('estimate_authorization', 'invoice_terms', 'sms_consent_disclosure', 'recovery_footer', 'retention_rules', 'texting_attestation')`,
    ),
    check("legal_policy_status_check", sql`${t.status} IN ('draft', 'approved', 'retired')`),
    check("legal_policy_version_check", sql`${t.version} >= 1`),
    check("legal_policy_jurisdiction_check", sql`${t.jurisdictionCode} ~ '^[A-Z]{2}-[A-Z]{2}$'`),
    check("legal_policy_body_hash_check", sql`${t.bodySha256} = encode(sha256(convert_to(${t.body}, 'UTF8')), 'hex')`),
    check(
      "legal_policy_approval_check",
      sql`${t.status} = 'draft' OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND length(btrim(${t.approvalReference})) > 0)`,
    ),
    // Approval requires a second admin (I5).
    check("legal_policy_second_admin_check", sql`${t.approvedBy} IS DISTINCT FROM ${t.createdByInternalUserId}`),
    check("legal_policy_retired_check", sql`(${t.status} = 'retired') = (${t.retiredAt} IS NOT NULL)`),
    foreignKey({
      columns: [t.createdByInternalUserId],
      foreignColumns: [internalUser.id],
      name: "legal_policy_created_by_fk",
    }),
    foreignKey({ columns: [t.approvedBy], foreignColumns: [internalUser.id], name: "legal_policy_approved_by_fk" }),
  ],
);
