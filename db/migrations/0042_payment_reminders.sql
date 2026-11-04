-- Automatic payment reminders: off until the owner turns them on.
ALTER TABLE app.business ADD COLUMN payment_reminders jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payment_reminders) = 'object');
--> statement-breakpoint
GRANT UPDATE (payment_reminders) ON app.business TO app_user;
--> statement-breakpoint
-- Every reminder sent (or that failed), per invoice.
CREATE TABLE app.payment_reminder (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 invoice_id uuid NOT NULL,
 sent_to text NOT NULL CHECK (length(sent_to) <= 320),
 status text NOT NULL CHECK (status IN ('sent', 'failed')),
 automatic boolean NOT NULL,
 provider_message_id text,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
CREATE INDEX payment_reminder_invoice_idx ON app.payment_reminder(business_id, invoice_id, created_at);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.payment_reminder');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.payment_reminder TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.payment_reminder TO worker_user, admin_user;
--> statement-breakpoint
-- Shops with reminders on, for the daily job.
CREATE FUNCTION app.payment_reminder_businesses() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT id FROM app.business WHERE status = 'active' AND (payment_reminders->>'on')::boolean IS TRUE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.payment_reminder_businesses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.payment_reminder_businesses() TO worker_user;
