CREATE TABLE app.estimate_version (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 quote_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), customer_id uuid NOT NULL, vehicle_id uuid NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), supplement_reason text,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 UNIQUE(business_id,id), UNIQUE(business_id,quote_id,version),
 FOREIGN KEY(business_id,customer_id,vehicle_id) REFERENCES app.vehicle(business_id,customer_id,id)
);
SELECT app.apply_tenant_rls('app.estimate_version');
GRANT SELECT,INSERT ON app.estimate_version TO app_user;
GRANT UPDATE(revoked_at,token_hash,expires_at) ON app.estimate_version TO app_user;
GRANT SELECT ON app.estimate_version TO worker_user,admin_user;
CREATE INDEX estimate_quote_idx ON app.estimate_version(business_id,quote_id,version DESC);
CREATE TABLE app.estimate_authorization (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid,
 version_id uuid NOT NULL UNIQUE, signer_name text NOT NULL CHECK(length(btrim(signer_name)) BETWEEN 1 AND 200),
 approved_line_ids jsonb NOT NULL CHECK(jsonb_typeof(approved_line_ids)='array'),
 consent_text text NOT NULL, ip text, request_id text NOT NULL,
 UNIQUE(business_id,id), FOREIGN KEY(business_id,version_id) REFERENCES app.estimate_version(business_id,id)
);
SELECT app.apply_tenant_rls('app.estimate_authorization');
GRANT SELECT ON app.estimate_authorization TO app_user,worker_user,admin_user;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.estimate_authorization FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.estimate_authorization FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
-- Narrow capability resolvers: no tenant IDs or snapshots are accepted from public callers.
CREATE POLICY capability_lock ON app.estimate_version FOR UPDATE TO migration_owner USING(true) WITH CHECK(true);
CREATE POLICY capability_lookup ON app.estimate_version FOR SELECT TO migration_owner USING(true);
CREATE POLICY capability_authorization ON app.estimate_authorization TO migration_owner USING(true) WITH CHECK(true);
CREATE POLICY capability_activity ON app.activity FOR INSERT TO migration_owner WITH CHECK(business_id=app.current_business_id());
CREATE POLICY capability_audit ON app.audit_event FOR INSERT TO migration_owner WITH CHECK(business_id=app.current_business_id());
CREATE FUNCTION app.read_estimate(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',e.id,'version',e.version,'snapshot',e.snapshot,'expiresAt',e.expires_at,
  'authorization',(SELECT jsonb_build_object('signerName',a.signer_name,'approvedLineIds',a.approved_line_ids,'signedAt',a.created_at,'consentText',a.consent_text) FROM app.estimate_authorization a WHERE a.version_id=e.id))
 FROM app.estimate_version e WHERE e.token_hash=p_hash AND e.revoked_at IS NULL AND e.expires_at>now()
$$;
GRANT EXECUTE ON FUNCTION app.read_estimate(text) TO app_user;
CREATE FUNCTION app.authorize_estimate(p_hash text,p_name text,p_ids jsonb,p_ip text,p_request text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.estimate_version; result uuid; consent text := 'I have reviewed this estimate version. I authorize only the selected items at the displayed prices and decline all unselected items. My typed name is my electronic signature.';
BEGIN
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
 VALUES(e.business_id,'estimate.authorized','vehicle',e.vehicle_id,'customer','Estimate authorization recorded',jsonb_build_object('versionId',e.id,'authorizationId',result));
 INSERT INTO app.audit_event(business_id,actor_type,action,target_type,target_id,request_id,"after")
 VALUES(e.business_id,'customer','estimate.authorized','estimate_version',e.id,p_request,jsonb_build_object('authorizationId',result,'approvedLineIds',p_ids));
 RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION app.authorize_estimate(text,text,jsonb,text,text) TO app_user;
