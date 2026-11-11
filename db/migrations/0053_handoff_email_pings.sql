-- Email a team member when an RO is handed to them (technician assigned,
-- inspection submitted to the advisor). On unless the owner turns it off.
ALTER TABLE app.business ADD COLUMN handoff_email_pings boolean NOT NULL DEFAULT true;
--> statement-breakpoint
GRANT UPDATE (handoff_email_pings) ON app.business TO app_user;
