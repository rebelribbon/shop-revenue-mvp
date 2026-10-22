CREATE TABLE "app"."business" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"legal_name" text NOT NULL,
	"dba" text,
	"phone_e164" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"jurisdiction_code" text DEFAULT 'US-TX' NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"logo_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_status_check" CHECK ("app"."business"."status" IN ('active', 'suspended', 'closed')),
	CONSTRAINT "business_tax_rate_bps_check" CHECK ("app"."business"."tax_rate_bps" BETWEEN 0 AND 2000),
	CONSTRAINT "business_phone_e164_check" CHECK ("app"."business"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "business_legal_name_check" CHECK (length(btrim("app"."business"."legal_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."internal_user" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auth_provider_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_user_email_key" UNIQUE("email"),
	CONSTRAINT "internal_user_auth_provider_id_key" UNIQUE("auth_provider_id"),
	CONSTRAINT "internal_user_role_check" CHECK ("app"."internal_user"."role" IN ('support', 'admin')),
	CONSTRAINT "internal_user_email_check" CHECK ("app"."internal_user"."email" = lower(btrim("app"."internal_user"."email")))
);
--> statement-breakpoint
CREATE TABLE "app"."location" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "location_business_id_id_key" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."membership" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"invite_name" text,
	"invite_email" text,
	"invite_phone_e164" text,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "membership_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "membership_business_id_user_id_key" UNIQUE("business_id","user_id"),
	CONSTRAINT "membership_invite_token_hash_key" UNIQUE("invite_token_hash"),
	CONSTRAINT "membership_role_check" CHECK ("app"."membership"."role" IN ('owner', 'staff')),
	CONSTRAINT "membership_status_check" CHECK ("app"."membership"."status" IN ('invited', 'active', 'removed')),
	CONSTRAINT "membership_user_required_check" CHECK ("app"."membership"."status" = 'invited' OR "app"."membership"."user_id" IS NOT NULL),
	CONSTRAINT "membership_invite_contact_check" CHECK ("app"."membership"."status" <> 'invited' OR "app"."membership"."invite_email" IS NOT NULL OR "app"."membership"."invite_phone_e164" IS NOT NULL),
	CONSTRAINT "membership_invite_email_check" CHECK ("app"."membership"."invite_email" = lower(btrim("app"."membership"."invite_email"))),
	CONSTRAINT "membership_invite_phone_e164_check" CHECK ("app"."membership"."invite_phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "app"."support_session" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_session_reason_check" CHECK (length(btrim("app"."support_session"."reason")) >= 10),
	CONSTRAINT "support_session_duration_check" CHECK ("app"."support_session"."expires_at" = "app"."support_session"."started_at" + interval '60 minutes'),
	CONSTRAINT "support_session_end_check" CHECK ("app"."support_session"."ended_at" IS NULL OR "app"."support_session"."ended_at" >= "app"."support_session"."started_at"),
	CONSTRAINT "support_session_end_reason_check" CHECK (("app"."support_session"."ended_at" IS NULL) = ("app"."support_session"."end_reason" IS NULL) AND ("app"."support_session"."end_reason" IS NULL OR "app"."support_session"."end_reason" IN ('ended', 'expired')))
);
--> statement-breakpoint
CREATE TABLE "app"."user" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"auth_provider_id" uuid NOT NULL,
	"email" text,
	"phone_e164" text,
	"display_name" text NOT NULL,
	"mfa_phone_e164" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_auth_provider_id_key" UNIQUE("auth_provider_id"),
	CONSTRAINT "user_email_key" UNIQUE("email"),
	CONSTRAINT "user_phone_e164_key" UNIQUE("phone_e164"),
	CONSTRAINT "user_status_check" CHECK ("app"."user"."status" IN ('active', 'deactivated')),
	CONSTRAINT "user_email_check" CHECK ("app"."user"."email" = lower(btrim("app"."user"."email"))),
	CONSTRAINT "user_phone_e164_check" CHECK ("app"."user"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "user_mfa_phone_e164_check" CHECK ("app"."user"."mfa_phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "app"."activity" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "activity_actor_type_check" CHECK ("app"."activity"."actor_type" IN ('user', 'customer', 'system', 'support')),
	CONSTRAINT "activity_kind_check" CHECK ("app"."activity"."kind" ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "activity_summary_check" CHECK (length("app"."activity"."summary") <= 280)
);
--> statement-breakpoint
CREATE TABLE "app"."audit_event" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"request_id" text NOT NULL,
	"support_session_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "audit_event_actor_type_check" CHECK ("app"."audit_event"."actor_type" IN ('user', 'customer', 'system', 'support', 'internal')),
	CONSTRAINT "audit_event_platform_scope_check" CHECK ("app"."audit_event"."business_id" IS NOT NULL OR "app"."audit_event"."actor_type" IN ('internal', 'system')),
	CONSTRAINT "audit_event_action_check" CHECK ("app"."audit_event"."action" ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "app"."file" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "file_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "file_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "file_kind_check" CHECK ("app"."file"."kind" IN ('estimate_photo', 'signature', 'estimate_pdf', 'invoice_pdf', 'authorization_pdf', 'logo', 'import_source', 'export')),
	CONSTRAINT "file_status_check" CHECK ("app"."file"."status" IN ('pending', 'ready', 'quarantined')),
	CONSTRAINT "file_byte_size_check" CHECK ("app"."file"."byte_size" >= 0),
	CONSTRAINT "file_sha256_check" CHECK ("app"."file"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_storage_key_prefix_check" CHECK ("app"."file"."storage_key" LIKE 'b/' || "app"."file"."business_id"::text || '/' || "app"."file"."kind" || '/%')
);
--> statement-breakpoint
CREATE TABLE "app"."legal_policy" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_internal_user_id" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_policy_version_key" UNIQUE("jurisdiction_code","kind","version"),
	CONSTRAINT "legal_policy_kind_check" CHECK ("app"."legal_policy"."kind" IN ('estimate_authorization', 'invoice_terms', 'sms_consent_disclosure', 'recovery_footer', 'retention_rules', 'texting_attestation')),
	CONSTRAINT "legal_policy_status_check" CHECK ("app"."legal_policy"."status" IN ('draft', 'approved', 'retired')),
	CONSTRAINT "legal_policy_version_check" CHECK ("app"."legal_policy"."version" >= 1),
	CONSTRAINT "legal_policy_jurisdiction_check" CHECK ("app"."legal_policy"."jurisdiction_code" ~ '^[A-Z]{2}-[A-Z]{2}$'),
	CONSTRAINT "legal_policy_body_hash_check" CHECK ("app"."legal_policy"."body_sha256" = encode(sha256(convert_to("app"."legal_policy"."body", 'UTF8')), 'hex')),
	CONSTRAINT "legal_policy_approval_check" CHECK ("app"."legal_policy"."status" = 'draft' OR ("app"."legal_policy"."approved_by" IS NOT NULL AND "app"."legal_policy"."approved_at" IS NOT NULL AND length(btrim("app"."legal_policy"."approval_reference")) > 0)),
	CONSTRAINT "legal_policy_second_admin_check" CHECK ("app"."legal_policy"."approved_by" IS DISTINCT FROM "app"."legal_policy"."created_by_internal_user_id"),
	CONSTRAINT "legal_policy_retired_check" CHECK (("app"."legal_policy"."status" = 'retired') = ("app"."legal_policy"."retired_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."request_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"client_request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"response_json" jsonb NOT NULL,
	CONSTRAINT "request_idempotency_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "request_idempotency_client_request_key" UNIQUE("business_id","client_request_id")
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"business_id" uuid,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_provider_event_key" UNIQUE("provider","provider_event_id"),
	CONSTRAINT "webhook_event_provider_check" CHECK ("app"."webhook_event"."provider" IN ('stripe', 'twilio', 'postmark')),
	CONSTRAINT "webhook_event_status_check" CHECK ("app"."webhook_event"."status" IN ('received', 'processing', 'applied', 'ignored', 'failed', 'dead')),
	CONSTRAINT "webhook_event_attempts_check" CHECK ("app"."webhook_event"."attempts" BETWEEN 0 AND 8),
	CONSTRAINT "webhook_event_signature_check" CHECK ("app"."webhook_event"."signature_valid")
);
--> statement-breakpoint
ALTER TABLE "app"."location" ADD CONSTRAINT "location_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."location" ADD CONSTRAINT "location_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_session" ADD CONSTRAINT "support_session_admin_fk" FOREIGN KEY ("admin_user_id") REFERENCES "app"."internal_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_session" ADD CONSTRAINT "support_session_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity" ADD CONSTRAINT "activity_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity" ADD CONSTRAINT "activity_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_support_session_fk" FOREIGN KEY ("support_session_id") REFERENCES "app"."support_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file" ADD CONSTRAINT "file_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file" ADD CONSTRAINT "file_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."legal_policy" ADD CONSTRAINT "legal_policy_created_by_fk" FOREIGN KEY ("created_by_internal_user_id") REFERENCES "app"."internal_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."legal_policy" ADD CONSTRAINT "legal_policy_approved_by_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."internal_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_idempotency" ADD CONSTRAINT "request_idempotency_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_idempotency" ADD CONSTRAINT "request_idempotency_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_event" ADD CONSTRAINT "webhook_event_business_fk" FOREIGN KEY ("business_id") REFERENCES "app"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_one_default_idx" ON "app"."location" USING btree ("business_id") WHERE "app"."location"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_active_owner_idx" ON "app"."membership" USING btree ("business_id") WHERE "app"."membership"."role" = 'owner' AND "app"."membership"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_staff_seat_idx" ON "app"."membership" USING btree ("business_id") WHERE "app"."membership"."role" = 'staff' AND "app"."membership"."status" IN ('invited', 'active');--> statement-breakpoint
CREATE INDEX "membership_user_id_idx" ON "app"."membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_session_business_started_idx" ON "app"."support_session" USING btree ("business_id","started_at");--> statement-breakpoint
CREATE INDEX "activity_business_occurred_idx" ON "app"."activity" USING btree ("business_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_business_subject_idx" ON "app"."activity" USING btree ("business_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_event_business_occurred_idx" ON "app"."audit_event" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "app"."audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_event_request_idx" ON "app"."audit_event" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_policy_one_approved_idx" ON "app"."legal_policy" USING btree ("jurisdiction_code","kind") WHERE "app"."legal_policy"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "request_idempotency_created_idx" ON "app"."request_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_status_received_idx" ON "app"."webhook_event" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_event_business_received_idx" ON "app"."webhook_event" USING btree ("business_id","received_at");