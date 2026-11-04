-- Tech board: who's on each job and each visit, so every tech's phone
-- shows just their work.
CREATE TABLE app.job_assignment (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 job_id uuid NOT NULL,
 user_id uuid REFERENCES app."user"(id),
 UNIQUE (business_id, id),
 UNIQUE (business_id, job_id)
);
--> statement-breakpoint
CREATE INDEX job_assignment_user_idx ON app.job_assignment(business_id, user_id);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.job_assignment');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.job_assignment TO app_user;
--> statement-breakpoint
GRANT UPDATE (user_id, updated_at) ON app.job_assignment TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.job_assignment TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.job_assignment FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
ALTER TABLE app.appointment ADD COLUMN assigned_user_id uuid REFERENCES app."user"(id);
