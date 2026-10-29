ALTER TABLE app.customer ADD COLUMN do_not_contact boolean NOT NULL DEFAULT false;
GRANT UPDATE(do_not_contact) ON app.customer TO app_user;
ALTER TABLE app.vehicle ADD COLUMN next_service_on date;
ALTER TABLE app.vehicle ADD COLUMN next_service_description text CHECK(next_service_description IS NULL OR length(btrim(next_service_description)) BETWEEN 1 AND 200);
ALTER TABLE app.vehicle ADD COLUMN next_service_amount_cents integer CHECK(next_service_amount_cents BETWEEN 0 AND 99999999);
ALTER TABLE app.vehicle ADD CHECK(next_service_on IS NOT NULL OR (next_service_description IS NULL AND next_service_amount_cents IS NULL));
GRANT UPDATE(next_service_on,next_service_description,next_service_amount_cents) ON app.vehicle TO app_user;
CREATE INDEX vehicle_service_due_idx ON app.vehicle(business_id,next_service_on) WHERE status='active' AND next_service_on IS NOT NULL;

CREATE TABLE app.recommendation (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL,vehicle_id uuid NOT NULL,description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 amount_cents bigint CHECK(amount_cents BETWEEN 0 AND 9007199254740991),declined_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','quoted','won','lost','dismissed')),
 source_version_id uuid,source_line_id text,
 UNIQUE(business_id,id), UNIQUE(business_id,source_version_id,source_line_id),
 CHECK((source_version_id IS NULL)=(source_line_id IS NULL)),
 FOREIGN KEY(business_id,customer_id,vehicle_id) REFERENCES app.vehicle(business_id,customer_id,id),
 FOREIGN KEY(business_id,source_version_id) REFERENCES app.estimate_version(business_id,id)
);
-- Backfill only actual signed declines; do not infer recommendations from notes.
INSERT INTO app.recommendation(business_id,customer_id,vehicle_id,description,amount_cents,declined_at,source_version_id,source_line_id,status)
 SELECT e.business_id,e.customer_id,e.vehicle_id,l->>'description',(l->>'totalCents')::bigint,a.created_at,e.id,l->>'id',CASE WHEN EXISTS(SELECT 1 FROM app.estimate_version newer WHERE newer.business_id=e.business_id AND newer.quote_id=e.quote_id AND newer.version>e.version) THEN 'quoted' ELSE 'open' END
 FROM app.estimate_authorization a JOIN app.estimate_version e ON e.business_id=a.business_id AND e.id=a.version_id
 CROSS JOIN LATERAL jsonb_array_elements(e.snapshot->'lines') l
 WHERE NOT a.approved_line_ids ? (l->>'id');
SELECT app.apply_tenant_rls('app.recommendation');
GRANT SELECT,INSERT ON app.recommendation TO app_user;
GRANT UPDATE(status) ON app.recommendation TO app_user;
GRANT SELECT ON app.recommendation TO worker_user,admin_user;
CREATE POLICY authorization_declines ON app.recommendation FOR INSERT TO migration_owner
 WITH CHECK(business_id=app.current_business_id() AND app.current_actor_type()='customer');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.recommendation FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE INDEX recommendation_open_idx ON app.recommendation(business_id,vehicle_id,declined_at) WHERE status IN ('open','dismissed');
CREATE FUNCTION app.capture_declined_recommendations() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 INSERT INTO app.recommendation(business_id,customer_id,vehicle_id,description,amount_cents,declined_at,source_version_id,source_line_id)
 SELECT e.business_id,e.customer_id,e.vehicle_id,l->>'description',(l->>'totalCents')::bigint,NEW.created_at,e.id,l->>'id'
 FROM app.estimate_version e CROSS JOIN LATERAL jsonb_array_elements(e.snapshot->'lines') l
 WHERE e.business_id=NEW.business_id AND e.id=NEW.version_id AND NOT NEW.approved_line_ids ? (l->>'id');
 RETURN NEW;
END $$;
CREATE TRIGGER capture_declines AFTER INSERT ON app.estimate_authorization FOR EACH ROW EXECUTE FUNCTION app.capture_declined_recommendations();

CREATE TABLE app.recovery_item (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 category text NOT NULL CHECK(category IN ('declined','open_estimate','unpaid_invoice','lapsed','service_due')),subject_id uuid NOT NULL,
 customer_id uuid NOT NULL,vehicle_id uuid,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','contacted','responded','booked','dismissed')),
 snoozed_until date,dismissed_reason text CHECK(dismissed_reason IS NULL OR length(btrim(dismissed_reason)) BETWEEN 1 AND 1000),
 dismissed_recommendation_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(dismissed_recommendation_ids)='array'),
 last_contact_at timestamptz,last_contact_method text CHECK(last_contact_method IN ('phone','email','in_person','other')),
 UNIQUE(business_id,id),UNIQUE(business_id,category,subject_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customer(business_id,id),
 FOREIGN KEY(business_id,customer_id,vehicle_id) REFERENCES app.vehicle(business_id,customer_id,id)
);
SELECT app.apply_tenant_rls('app.recovery_item');
GRANT SELECT,INSERT ON app.recovery_item TO app_user;
GRANT UPDATE(status,snoozed_until,dismissed_reason,dismissed_recommendation_ids,last_contact_at,last_contact_method) ON app.recovery_item TO app_user;
GRANT SELECT ON app.recovery_item TO worker_user,admin_user;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.recovery_item FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE INDEX recovery_item_customer_contact_idx ON app.recovery_item(business_id,customer_id,last_contact_at);
CREATE INDEX invoice_money_customer_idx ON app.invoice(business_id,customer_id,created_at) WHERE voided_at IS NULL;

ALTER TABLE app.estimate_version ADD COLUMN source_recovery_item_id uuid;
ALTER TABLE app.estimate_version ADD FOREIGN KEY(business_id,source_recovery_item_id) REFERENCES app.recovery_item(business_id,id);
ALTER TABLE app.appointment ADD COLUMN source_recovery_item_id uuid;
ALTER TABLE app.appointment ADD FOREIGN KEY(business_id,source_recovery_item_id) REFERENCES app.recovery_item(business_id,id);
