-- Recurring work: a customer signs one estimate whose terms repeat; the shop
-- starts a service plan from it, visits are generated ahead, and each completed
-- visit is billed (per visit, or monthly for that month's visits).
ALTER TABLE app.business DROP CONSTRAINT business_business_type_check;
--> statement-breakpoint
ALTER TABLE app.business ADD CONSTRAINT business_business_type_check CHECK (business_type IN ('automotive','hvac','plumbing','home_improvement','handyman','landscaping','cleaning','pool','pest_control','other_home_service'));
--> statement-breakpoint
CREATE TABLE app.service_plan (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL, vehicle_id uuid, service_asset_id uuid,
 quote_id uuid NOT NULL, version_id uuid NOT NULL, authorization_id uuid NOT NULL,
 title text NOT NULL CHECK (length(btrim(title)) > 0),
 repeat jsonb NOT NULL,
 per_visit_cents bigint NOT NULL CHECK (per_visit_cents > 0 AND per_visit_cents <= 99999999),
 billing text NOT NULL CHECK (billing IN ('per_visit','monthly')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
 paused_at timestamptz, ended_at timestamptz, end_reason text,
 UNIQUE (business_id, id),
 FOREIGN KEY (business_id, quote_id, version_id) REFERENCES app.estimate_version(business_id, quote_id, id),
 FOREIGN KEY (business_id, version_id, authorization_id) REFERENCES app.estimate_authorization(business_id, version_id, id),
 FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX service_plan_one_open_per_job ON app.service_plan(business_id, quote_id) WHERE status <> 'ended';
--> statement-breakpoint
CREATE INDEX service_plan_customer_idx ON app.service_plan(business_id, customer_id);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.service_plan');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.service_plan TO app_user, worker_user;
--> statement-breakpoint
GRANT UPDATE (status, paused_at, ended_at, end_reason, updated_at) ON app.service_plan TO app_user, worker_user;
--> statement-breakpoint
GRANT SELECT ON app.service_plan TO admin_user;
--> statement-breakpoint
ALTER TABLE app.appointment ADD COLUMN service_plan_id uuid;
--> statement-breakpoint
ALTER TABLE app.appointment ADD COLUMN plan_visit_on date;
--> statement-breakpoint
ALTER TABLE app.appointment ADD COLUMN plan_invoice_id uuid;
--> statement-breakpoint
ALTER TABLE app.appointment ADD CONSTRAINT appointment_plan_fk FOREIGN KEY (business_id, service_plan_id) REFERENCES app.service_plan(business_id, id);
--> statement-breakpoint
ALTER TABLE app.appointment ADD CONSTRAINT appointment_plan_invoice_fk FOREIGN KEY (business_id, plan_invoice_id) REFERENCES app.invoice(business_id, id);
--> statement-breakpoint
ALTER TABLE app.appointment ADD CONSTRAINT appointment_plan_shape CHECK ((service_plan_id IS NULL) = (plan_visit_on IS NULL) AND (plan_invoice_id IS NULL OR service_plan_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX appointment_plan_visit_once ON app.appointment(business_id, service_plan_id, plan_visit_on) WHERE service_plan_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX appointment_plan_invoice_idx ON app.appointment(business_id, plan_invoice_id) WHERE plan_invoice_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE app.invoice ADD COLUMN service_plan_id uuid;
--> statement-breakpoint
ALTER TABLE app.invoice ADD CONSTRAINT invoice_plan_fk FOREIGN KEY (business_id, service_plan_id) REFERENCES app.service_plan(business_id, id);
--> statement-breakpoint
-- One open invoice per one-time job; a plan bills many times from one signature.
DROP INDEX app.invoice_one_active_quote;
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_one_active_quote ON app.invoice(business_id, quote_id) WHERE voided_at IS NULL AND service_plan_id IS NULL;
--> statement-breakpoint
CREATE INDEX invoice_plan_idx ON app.invoice(business_id, service_plan_id) WHERE service_plan_id IS NOT NULL;
--> statement-breakpoint
-- Lets the scheduler lookup below (SECURITY DEFINER) see plans.
CREATE POLICY plan_scheduler ON app.service_plan FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
-- Businesses with active plans, for the daily scheduler (no tenant data returned).
CREATE FUNCTION app.service_plan_businesses() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT DISTINCT business_id FROM app.service_plan WHERE status = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.service_plan_businesses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.service_plan_businesses() TO worker_user;
