-- M1 audit finding (2026-10-24): audit_event.support_session_id referenced
-- support_session(id) only, so a tenant A audit row could point at tenant B's
-- support session. Add the tenant-composite reference (Section 8/9). The
-- unique key must exist before the foreign key that targets it.
ALTER TABLE "app"."support_session" ADD CONSTRAINT "support_session_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "app"."audit_event" ADD CONSTRAINT "audit_event_support_session_tenant_fk" FOREIGN KEY ("business_id","support_session_id") REFERENCES "app"."support_session"("business_id","id") ON DELETE no action ON UPDATE no action;
