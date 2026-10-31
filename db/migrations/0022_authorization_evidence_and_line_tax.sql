-- Forward-only: old signed evidence and frozen tax totals remain unchanged.
ALTER TABLE app.business ADD COLUMN parts_taxable_default boolean NOT NULL DEFAULT true;
ALTER TABLE app.business ADD COLUMN labor_taxable_default boolean NOT NULL DEFAULT false;
GRANT UPDATE(parts_taxable_default,labor_taxable_default) ON app.business TO app_user;
ALTER TABLE app.estimate_authorization
 ADD COLUMN user_agent text,
 ADD COLUMN estimate_sha256 text,
 ADD COLUMN policy_id uuid REFERENCES app.legal_policy(id),
 ADD COLUMN policy_version integer,
 ADD COLUMN policy_sha256 text,
 ADD COLUMN line_decisions jsonb,
 ADD COLUMN signature_strokes jsonb,
 ADD COLUMN evidence_pdf_base64 text,
 ADD COLUMN evidence_pdf_sha256 text;
CREATE INDEX authorization_policy_idx ON app.estimate_authorization(policy_id);
-- Capability functions may inspect published policy status; drafts stay hidden.
CREATE POLICY capability_policy_read ON app.legal_policy FOR SELECT TO migration_owner USING(status IN ('approved','retired'));

-- Publishing through another code path must enforce the same policy gate.
CREATE FUNCTION app.guard_estimate_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE p app.legal_policy; jurisdiction text;
BEGIN
 SELECT jurisdiction_code INTO jurisdiction FROM app.business WHERE id=NEW.business_id;
 SELECT * INTO p FROM app.legal_policy WHERE id=(NEW.snapshot->'authorizationPolicy'->>'id')::uuid
  AND jurisdiction_code=jurisdiction AND kind='estimate_authorization' AND status='approved';
 IF NOT FOUND OR NEW.snapshot->'authorizationPolicy' IS DISTINCT FROM jsonb_build_object('id',p.id,'version',p.version,'jurisdictionCode',p.jurisdiction_code,'body',p.body,'bodySha256',p.body_sha256)
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: approved authorization policy required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER estimate_policy_gate BEFORE INSERT ON app.estimate_version FOR EACH ROW EXECUTE FUNCTION app.guard_estimate_policy();

CREATE OR REPLACE FUNCTION app.read_estimate(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',e.id,'version',e.version,'supplementReason',e.supplement_reason,'snapshot',e.snapshot,
  'estimateSha256',encode(sha256(convert_to(e.snapshot::text,'UTF8')),'hex'),'expiresAt',e.expires_at,
  'authorization',(SELECT jsonb_build_object('signerName',a.signer_name,'approvedLineIds',a.approved_line_ids,'signedAt',a.created_at,'consentText',a.consent_text) FROM app.estimate_authorization a WHERE a.version_id=e.id))
 FROM app.estimate_version e WHERE e.token_hash=p_hash AND e.revoked_at IS NULL AND e.expires_at>now()
 AND (EXISTS(SELECT 1 FROM app.estimate_authorization a WHERE a.version_id=e.id)
  OR EXISTS(SELECT 1 FROM app.legal_policy p WHERE p.id=(e.snapshot->'authorizationPolicy'->>'id')::uuid AND p.status='approved' AND p.kind='estimate_authorization' AND p.body_sha256=e.snapshot->'authorizationPolicy'->>'bodySha256'))
$$;
-- Remove the old five-argument entry point: it cannot bypass complete decisions/evidence.
DROP FUNCTION app.authorize_estimate(text,text,jsonb,text,text);
CREATE FUNCTION app.authorize_estimate(p_hash text,p_name text,p_decisions jsonb,p_ip text,p_request text,p_agent text,p_strokes jsonb,p_estimate_hash text,p_signed_at timestamptz,p_pdf text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.estimate_version; p app.legal_policy; result uuid; ids jsonb; s jsonb; pt jsonb; point_count integer:=0;
BEGIN
 IF app.current_actor_type() IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'INVALID_TRANSITION: customer authorization context required'; END IF;
 SELECT * INTO e FROM app.estimate_version WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR e.revoked_at IS NOT NULL OR e.expires_at<=now() THEN RAISE EXCEPTION 'INVALID_TRANSITION: estimate unavailable'; END IF;
 SELECT * INTO p FROM app.legal_policy WHERE id=(e.snapshot->'authorizationPolicy'->>'id')::uuid AND status='approved' AND kind='estimate_authorization' FOR SHARE;
 IF NOT FOUND OR e.snapshot->'authorizationPolicy' IS DISTINCT FROM jsonb_build_object('id',p.id,'version',p.version,'jurisdictionCode',p.jurisdiction_code,'body',p.body,'bodySha256',p.body_sha256)
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: approved authorization policy required'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(p_request) NOT BETWEEN 1 AND 200 OR p_request IS NULL
  OR coalesce(length(p_agent),0)>2000 OR jsonb_typeof(p_decisions) IS DISTINCT FROM 'array'
  OR p_estimate_hash IS DISTINCT FROM encode(sha256(convert_to(e.snapshot::text,'UTF8')),'hex')
  OR p_signed_at IS NULL OR abs(extract(epoch FROM clock_timestamp()-p_signed_at))>60
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid signature evidence'; END IF;
 IF jsonb_array_length(p_decisions)<>jsonb_array_length(e.snapshot->'lines')
  OR (SELECT count(DISTINCT d->>'id') FROM jsonb_array_elements(p_decisions) d)<>jsonb_array_length(p_decisions)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) d WHERE jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->>'decision' IS NULL OR d->>'decision' NOT IN ('approve','decline') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.snapshot->'lines') l WHERE l->>'id'=d->>'id'))
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: decide every estimate line explicitly'; END IF;
 IF jsonb_typeof(p_strokes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_strokes) NOT BETWEEN 1 AND 20 OR length(p_strokes::text)>250000
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: drawn signature required'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_strokes) LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'array' OR jsonb_array_length(s) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid signature stroke'; END IF;
  point_count:=point_count+jsonb_array_length(s);
  FOR pt IN SELECT value FROM jsonb_array_elements(s) LOOP
   IF jsonb_typeof(pt->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(pt->'y') IS DISTINCT FROM 'number'
    OR (pt->>'x')::numeric NOT BETWEEN 0 AND 1 OR (pt->>'y')::numeric NOT BETWEEN 0 AND 1
   THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid signature point'; END IF;
  END LOOP;
 END LOOP;
 IF point_count>5000 OR p_pdf IS NULL OR length(p_pdf) NOT BETWEEN 100 AND 8000000 OR substring(decode(p_pdf,'base64') from 1 for 5)<>convert_to('%PDF-','UTF8')
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: archived authorization PDF required'; END IF;
 IF EXISTS(SELECT 1 FROM app.estimate_authorization WHERE version_id=e.id) THEN RAISE EXCEPTION 'INVALID_TRANSITION: already signed'; END IF;
 SELECT coalesce(jsonb_agg(d->>'id'),'[]'::jsonb) INTO ids FROM jsonb_array_elements(p_decisions) d WHERE d->>'decision'='approve';
 PERFORM set_config('app.business_id',e.business_id::text,true);
 INSERT INTO app.estimate_authorization(business_id,version_id,signer_name,approved_line_ids,consent_text,ip,request_id,created_at,user_agent,estimate_sha256,policy_id,policy_version,policy_sha256,line_decisions,signature_strokes,evidence_pdf_base64,evidence_pdf_sha256)
 VALUES(e.business_id,e.id,btrim(p_name),ids,p.body,p_ip,p_request,p_signed_at,p_agent,p_estimate_hash,p.id,p.version,p.body_sha256,p_decisions,p_strokes,p_pdf,encode(sha256(decode(p_pdf,'base64')),'hex')) RETURNING id INTO result;
 INSERT INTO app.activity(business_id,kind,subject_type,subject_id,actor_type,summary,data)
 VALUES(e.business_id,'estimate.authorized',CASE WHEN e.vehicle_id IS NULL THEN 'customer' ELSE 'vehicle' END,coalesce(e.vehicle_id,e.customer_id),'customer','Estimate authorization recorded',jsonb_build_object('versionId',e.id,'authorizationId',result));
 INSERT INTO app.audit_event(business_id,actor_type,action,target_type,target_id,request_id,"after")
 VALUES(e.business_id,'customer','estimate.authorized','estimate_version',e.id,p_request,jsonb_build_object('authorizationId',result,'approvedLineIds',ids,'policyId',p.id,'estimateSha256',p_estimate_hash));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.authorize_estimate(text,text,jsonb,text,text,text,jsonb,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_estimate(text,text,jsonb,text,text,text,jsonb,text,timestamptz,text) TO app_user;
CREATE FUNCTION app.read_authorization_pdf(p_hash text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT a.evidence_pdf_base64 FROM app.estimate_version e JOIN app.estimate_authorization a ON a.business_id=e.business_id AND a.version_id=e.id
 WHERE e.token_hash=p_hash AND e.revoked_at IS NULL AND e.expires_at>now()
$$;
REVOKE ALL ON FUNCTION app.read_authorization_pdf(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_authorization_pdf(text) TO app_user;
