-- Preserve existing automotive tenants and records; owners explicitly choose their workspace.
-- Existing estimate/invoice capability policies expose rows to migration_owner,
-- while FORCE RLS hides customers without a tenant context. Initial FK validation
-- must see both sides. This read policy exists only inside the migration transaction
-- and is removed below; runtime roles and committed tenant policies are unchanged.
CREATE POLICY workspace_migration_customer_validation ON app.customer FOR SELECT TO migration_owner USING (true);
ALTER TABLE app.business ADD COLUMN business_type text NOT NULL DEFAULT 'automotive' CHECK(business_type IN ('automotive','hvac','plumbing','home_improvement','handyman','other_home_service'));
ALTER TABLE app.business ADD COLUMN business_type_selected boolean NOT NULL DEFAULT false;
GRANT UPDATE(business_type,business_type_selected) ON app.business TO app_user;
ALTER TABLE app.asset DROP CONSTRAINT asset_type_check;
ALTER TABLE app.asset ADD CONSTRAINT asset_type_check CHECK(type IN ('vehicle','property','equipment'));
ALTER TABLE app.asset ADD COLUMN parent_asset_id uuid;
ALTER TABLE app.asset ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object');
ALTER TABLE app.asset ADD CONSTRAINT asset_business_customer_id_key UNIQUE(business_id,customer_id,id);
ALTER TABLE app.asset ADD CONSTRAINT asset_parent_customer_fk FOREIGN KEY(business_id,customer_id,parent_asset_id) REFERENCES app.asset(business_id,customer_id,id);
CREATE INDEX asset_parent_idx ON app.asset(business_id,customer_id,parent_asset_id);
GRANT UPDATE(parent_asset_id,details) ON app.asset TO app_user;
ALTER TABLE app.estimate_version ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE app.estimate_version ADD COLUMN service_asset_id uuid;
ALTER TABLE app.estimate_version ADD CONSTRAINT estimate_version_service_asset_customer_fk FOREIGN KEY(business_id,customer_id,service_asset_id) REFERENCES app.asset(business_id,customer_id,id);
ALTER TABLE app.estimate_version ADD CONSTRAINT estimate_version_customer_fk FOREIGN KEY(business_id,customer_id) REFERENCES app.customer(business_id,id);
ALTER TABLE app.estimate_version ADD CONSTRAINT estimate_version_work_target_check CHECK((vehicle_id IS NOT NULL)::int + (service_asset_id IS NOT NULL)::int = 1);
CREATE INDEX estimate_version_service_asset_idx ON app.estimate_version(business_id,customer_id,service_asset_id);
ALTER TABLE app.invoice ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE app.invoice ADD COLUMN service_asset_id uuid;
ALTER TABLE app.invoice ADD CONSTRAINT invoice_service_asset_customer_fk FOREIGN KEY(business_id,customer_id,service_asset_id) REFERENCES app.asset(business_id,customer_id,id);
ALTER TABLE app.invoice ADD CONSTRAINT invoice_customer_fk FOREIGN KEY(business_id,customer_id) REFERENCES app.customer(business_id,id);
ALTER TABLE app.invoice ADD CONSTRAINT invoice_work_target_check CHECK((vehicle_id IS NOT NULL)::int + (service_asset_id IS NOT NULL)::int = 1);
CREATE INDEX invoice_service_asset_idx ON app.invoice(business_id,customer_id,service_asset_id);
ALTER TABLE app.recommendation ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE app.recommendation ADD CONSTRAINT recommendation_customer_fk FOREIGN KEY(business_id,customer_id) REFERENCES app.customer(business_id,id);
CREATE OR REPLACE FUNCTION app.authorize_estimate(p_hash text,p_name text,p_ids jsonb,p_ip text,p_request text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.estimate_version; result uuid; consent text := 'I have reviewed this estimate version. I authorize only the selected items at the displayed prices and decline all unselected items. My typed name is my electronic signature.';
BEGIN
 IF app.current_actor_type() IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'INVALID_TRANSITION: customer authorization context required'; END IF;
 SELECT * INTO e FROM app.estimate_version WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR e.revoked_at IS NOT NULL OR e.expires_at<=now() THEN RAISE EXCEPTION 'INVALID_TRANSITION: estimate unavailable'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid signature'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_ids) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.snapshot->'lines') l WHERE l->>'id'=x))
 OR (SELECT count(*) FROM jsonb_array_elements_text(p_ids))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_ids) x)
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid line selection'; END IF;
 IF EXISTS(SELECT 1 FROM app.estimate_authorization WHERE version_id=e.id) THEN RAISE EXCEPTION 'INVALID_TRANSITION: already signed'; END IF;
 PERFORM set_config('app.business_id',e.business_id::text,true);
 INSERT INTO app.estimate_authorization(business_id,version_id,signer_name,approved_line_ids,consent_text,ip,request_id)
 VALUES(e.business_id,e.id,btrim(p_name),p_ids,consent,p_ip,p_request) RETURNING id INTO result;
 INSERT INTO app.activity(business_id,kind,subject_type,subject_id,actor_type,summary,data)
 VALUES(e.business_id,'estimate.authorized',CASE WHEN e.vehicle_id IS NOT NULL THEN 'vehicle' ELSE 'customer' END,coalesce(e.vehicle_id,e.customer_id),'customer','Estimate authorization recorded',jsonb_build_object('versionId',e.id,'authorizationId',result));
 INSERT INTO app.audit_event(business_id,actor_type,action,target_type,target_id,request_id,"after")
 VALUES(e.business_id,'customer','estimate.authorized','estimate_version',e.id,p_request,jsonb_build_object('authorizationId',result,'approvedLineIds',p_ids));
 RETURN result;
END $$;

ALTER TABLE app.appointment ADD COLUMN service_asset_id uuid;
ALTER TABLE app.appointment ADD CONSTRAINT appointment_service_asset_customer_fk FOREIGN KEY(business_id,customer_id,service_asset_id) REFERENCES app.asset(business_id,customer_id,id);
ALTER TABLE app.appointment ADD CONSTRAINT appointment_work_target_check CHECK(vehicle_id IS NULL OR service_asset_id IS NULL);
CREATE INDEX appointment_service_asset_idx ON app.appointment(business_id,customer_id,service_asset_id);

DROP POLICY workspace_migration_customer_validation ON app.customer;
