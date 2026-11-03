-- Reports the owner built and saved, optionally pinned to Home.
CREATE TABLE app.saved_report (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
 pinned boolean NOT NULL DEFAULT false,
 archived_at timestamptz,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.saved_report');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.saved_report TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, config, pinned, archived_at, updated_at) ON app.saved_report TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.saved_report TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.saved_report FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
