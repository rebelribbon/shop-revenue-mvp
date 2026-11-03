-- Profit on every job: the shop's target margin, and techs clocking time
-- on jobs so labor cost uses real hours.
ALTER TABLE app.business ADD COLUMN target_margin_bps integer NOT NULL DEFAULT 4000 CHECK (target_margin_bps BETWEEN 0 AND 9500);
--> statement-breakpoint
GRANT UPDATE (target_margin_bps) ON app.business TO app_user;
--> statement-breakpoint
CREATE TABLE app.time_entry (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 job_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES app."user"(id),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CHECK (ended_at IS NULL OR ended_at >= started_at),
 UNIQUE (business_id, id)
);
--> statement-breakpoint
-- One running clock per person.
CREATE UNIQUE INDEX time_entry_one_open ON app.time_entry(business_id, user_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX time_entry_job_idx ON app.time_entry(business_id, job_id);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.time_entry');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.time_entry TO app_user;
--> statement-breakpoint
GRANT UPDATE (ended_at, updated_at) ON app.time_entry TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.time_entry TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.time_entry FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
