ALTER TABLE app.estimate_version ADD COLUMN source_contact_activity_id uuid;
ALTER TABLE app.estimate_version ADD COLUMN source_appointment_id uuid;
ALTER TABLE app.appointment ADD COLUMN source_contact_activity_id uuid;
ALTER TABLE app.estimate_version ADD FOREIGN KEY(business_id,source_contact_activity_id) REFERENCES app.activity(business_id,id);
ALTER TABLE app.estimate_version ADD FOREIGN KEY(business_id,source_appointment_id) REFERENCES app.appointment(business_id,id);
ALTER TABLE app.appointment ADD FOREIGN KEY(business_id,source_contact_activity_id) REFERENCES app.activity(business_id,id);
CREATE INDEX estimate_contact_source_idx ON app.estimate_version(business_id,source_contact_activity_id);
CREATE INDEX estimate_appointment_source_idx ON app.estimate_version(business_id,source_appointment_id);
CREATE INDEX appointment_contact_source_idx ON app.appointment(business_id,source_contact_activity_id);
CREATE INDEX activity_recovery_contact_idx ON app.activity(business_id,(data->>'recoveryItemId'),occurred_at) WHERE kind IN ('recovery.contact','recovery.responded');

CREATE TABLE app.estimate_recommendation_line (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 version_id uuid NOT NULL,line_id text NOT NULL,recommendation_id uuid NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,version_id,line_id),
 FOREIGN KEY(business_id,version_id) REFERENCES app.estimate_version(business_id,id),
 FOREIGN KEY(business_id,recommendation_id) REFERENCES app.recommendation(business_id,id)
);
SELECT app.apply_tenant_rls('app.estimate_recommendation_line');
GRANT SELECT,INSERT ON app.estimate_recommendation_line TO app_user;
GRANT SELECT ON app.estimate_recommendation_line TO worker_user,admin_user;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.estimate_recommendation_line FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE INDEX estimate_recommendation_ref_idx ON app.estimate_recommendation_line(business_id,recommendation_id);
CREATE INDEX estimate_recommendation_creator_idx ON app.estimate_recommendation_line(created_by_user_id);

CREATE TABLE app.revenue_attribution (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 invoice_id uuid NOT NULL,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 classification text NOT NULL DEFAULT 'none' CHECK(classification IN ('none','direct','influenced')),
 amount_cents bigint NOT NULL DEFAULT 0 CHECK(amount_cents BETWEEN 0 AND 9007199254740991),
 contact_activity_id uuid,response_activity_id uuid,recovery_item_id uuid,
 rule_code text NOT NULL DEFAULT 'NONE' CHECK(rule_code IN ('NONE','D-UNPAID','D-ESTIMATE','D-DECLINED','D-VISIT','I-RETURN')),
 rule_version text NOT NULL,excluded boolean NOT NULL DEFAULT false,decision jsonb NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,invoice_id),
 CHECK((classification='none' AND amount_cents=0) OR (classification<>'none' AND amount_cents>0 AND contact_activity_id IS NOT NULL AND recovery_item_id IS NOT NULL)),
 CHECK(classification<>'direct' OR response_activity_id IS NOT NULL),
 FOREIGN KEY(business_id,invoice_id) REFERENCES app.invoice(business_id,id),
 FOREIGN KEY(business_id,contact_activity_id) REFERENCES app.activity(business_id,id),
 FOREIGN KEY(business_id,response_activity_id) REFERENCES app.activity(business_id,id),
 FOREIGN KEY(business_id,recovery_item_id) REFERENCES app.recovery_item(business_id,id)
);
SELECT app.apply_tenant_rls('app.revenue_attribution');
GRANT SELECT,INSERT ON app.revenue_attribution TO app_user,worker_user;
GRANT UPDATE(revision,classification,amount_cents,contact_activity_id,response_activity_id,recovery_item_id,rule_code,rule_version,excluded,decision) ON app.revenue_attribution TO app_user,worker_user;
GRANT SELECT ON app.revenue_attribution TO admin_user;
CREATE UNIQUE INDEX revenue_one_influenced_contact_idx ON app.revenue_attribution(business_id,contact_activity_id) WHERE classification='influenced';
CREATE INDEX revenue_response_ref_idx ON app.revenue_attribution(business_id,response_activity_id);
CREATE INDEX revenue_recovery_ref_idx ON app.revenue_attribution(business_id,recovery_item_id);
CREATE INDEX revenue_contact_ref_idx ON app.revenue_attribution(business_id,contact_activity_id);
CREATE INDEX revenue_creator_idx ON app.revenue_attribution(created_by_user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.revenue_attribution FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE FUNCTION app.guard_revenue_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.excluded) OR (TG_OP='UPDATE' AND NEW.excluded IS DISTINCT FROM OLD.excluded) THEN
  IF app.current_actor_type()<>'user' OR NOT EXISTS(SELECT 1 FROM app.membership WHERE business_id=NEW.business_id AND user_id=app.current_actor_id() AND role='owner' AND status='active') THEN
   RAISE EXCEPTION 'INVALID_TRANSITION: only owner may change revenue review status';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_review BEFORE INSERT OR UPDATE ON app.revenue_attribution FOR EACH ROW EXECUTE FUNCTION app.guard_revenue_review();

CREATE TABLE app.revenue_attribution_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 attribution_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 direct_delta_cents bigint NOT NULL,influenced_delta_cents bigint NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 "before" jsonb NOT NULL,"after" jsonb NOT NULL,rule_version text NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,attribution_id,revision),
 FOREIGN KEY(business_id,attribution_id) REFERENCES app.revenue_attribution(business_id,id)
);
SELECT app.apply_tenant_rls('app.revenue_attribution_event');
GRANT SELECT,INSERT ON app.revenue_attribution_event TO app_user,worker_user;
GRANT SELECT ON app.revenue_attribution_event TO admin_user;
CREATE INDEX revenue_event_month_idx ON app.revenue_attribution_event(business_id,created_at);
CREATE INDEX revenue_event_creator_idx ON app.revenue_attribution_event(created_by_user_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.revenue_attribution_event FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

CREATE FUNCTION app.guard_recommendation_line() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.estimate_version e JOIN app.recommendation r ON r.business_id=e.business_id AND r.customer_id=e.customer_id AND r.vehicle_id=e.vehicle_id
  WHERE e.business_id=NEW.business_id AND e.id=NEW.version_id AND r.id=NEW.recommendation_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.snapshot->'lines') line WHERE line->>'id'=NEW.line_id)) THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: recommendation must match a real line and vehicle';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_line BEFORE INSERT ON app.estimate_recommendation_line FOR EACH ROW EXECUTE FUNCTION app.guard_recommendation_line();
