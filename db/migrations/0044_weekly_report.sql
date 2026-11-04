-- Monday summary email to the owner(s). On unless the owner turns it off.
ALTER TABLE app.business ADD COLUMN weekly_report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(weekly_report) = 'object');
--> statement-breakpoint
GRANT UPDATE (weekly_report) ON app.business TO app_user;
--> statement-breakpoint
CREATE TABLE app.weekly_report (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 week_start date NOT NULL,
 sent_to text NOT NULL CHECK (length(sent_to) <= 320),
 status text NOT NULL CHECK (status IN ('sent', 'failed')),
 automatic boolean NOT NULL,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
CREATE INDEX weekly_report_week_idx ON app.weekly_report(business_id, week_start);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.weekly_report');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.weekly_report TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.weekly_report TO worker_user, admin_user;
--> statement-breakpoint
CREATE FUNCTION app.weekly_report_businesses() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT id FROM app.business WHERE status = 'active' AND (weekly_report->>'on')::boolean IS DISTINCT FROM false
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.weekly_report_businesses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.weekly_report_businesses() TO worker_user;
