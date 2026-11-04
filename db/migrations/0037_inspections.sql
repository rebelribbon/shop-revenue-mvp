-- Digital inspections: one checklist per job, Good / Watch / Needs work.
CREATE TABLE app.inspection (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 job_id uuid NOT NULL,
 items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
 completed_at timestamptz,
 UNIQUE (business_id, id),
 UNIQUE (business_id, job_id)
);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.inspection');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.inspection TO app_user;
--> statement-breakpoint
GRANT UPDATE (items, completed_at, updated_at) ON app.inspection TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.inspection TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.inspection FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
