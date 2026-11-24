-- Shop owners may enable their own customer authorization terms. This records
-- owner approval only; existing platform/attorney-approved policies are unchanged.
CREATE TABLE app.shop_authorization_terms (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id uuid NOT NULL REFERENCES app."user"(id),
 version integer NOT NULL CHECK (version > 0), jurisdiction_code text NOT NULL CHECK(jurisdiction_code ~ '^[A-Z]{2}-[A-Z]{2}$'),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 20 AND 8000), body_sha256 text NOT NULL,
 CHECK(body_sha256 = encode(sha256(convert_to(body,'UTF8')),'hex')),
 UNIQUE(business_id,id), UNIQUE(business_id,version)
);
SELECT app.apply_tenant_rls('app.shop_authorization_terms');
GRANT SELECT, INSERT ON app.shop_authorization_terms TO app_user;
GRANT SELECT ON app.shop_authorization_terms TO worker_user, admin_user;
CREATE POLICY owner_enables ON app.shop_authorization_terms AS RESTRICTIVE FOR INSERT TO app_user
 WITH CHECK(app.current_actor_type()='user' AND created_by_user_id=app.current_actor_id()
 AND EXISTS(SELECT 1 FROM app.membership m WHERE m.business_id=shop_authorization_terms.business_id
   AND m.user_id=app.current_actor_id() AND m.role='owner' AND m.status='active'));
CREATE POLICY capability_terms_read ON app.shop_authorization_terms FOR SELECT TO migration_owner USING(true);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.shop_authorization_terms FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.shop_authorization_terms FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.estimate_authorization ADD COLUMN shop_policy_id uuid;
ALTER TABLE app.estimate_authorization ADD CONSTRAINT authorization_shop_policy_fk
 FOREIGN KEY (business_id,shop_policy_id) REFERENCES app.shop_authorization_terms(business_id,id);

-- Invoker access remains tenant-scoped. Existing token capability functions can
-- resolve only the estimate's own shop and exact immutable version.
CREATE FUNCTION app.shop_authorization_policy(p_business uuid,p_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('source','shop','businessId',t.business_id,'id',t.id,'version',t.version,
 'jurisdictionCode',t.jurisdiction_code,'body',t.body,'bodySha256',t.body_sha256)
 FROM app.shop_authorization_terms t JOIN app.business b ON b.id=t.business_id
 WHERE t.business_id=p_business AND t.id=p_id AND t.jurisdiction_code=b.jurisdiction_code
 AND NOT EXISTS(SELECT 1 FROM app.shop_authorization_terms newer WHERE newer.business_id=t.business_id AND newer.version>t.version)
$$;
REVOKE ALL ON FUNCTION app.shop_authorization_policy(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.shop_authorization_policy(uuid,uuid) TO app_user;

CREATE OR REPLACE FUNCTION app.guard_estimate_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE p app.legal_policy; jurisdiction text;
BEGIN
 IF NEW.snapshot->'authorizationPolicy'->>'source'='shop' THEN
  IF NEW.snapshot->'authorizationPolicy' IS DISTINCT FROM app.shop_authorization_policy(NEW.business_id,(NEW.snapshot->'authorizationPolicy'->>'id')::uuid)
  THEN RAISE EXCEPTION 'INVALID_TRANSITION: owner-enabled authorization terms required'; END IF;
  RETURN NEW;
 END IF;
 SELECT jurisdiction_code INTO jurisdiction FROM app.business WHERE id=NEW.business_id;
 SELECT * INTO p FROM app.legal_policy WHERE id=(NEW.snapshot->'authorizationPolicy'->>'id')::uuid
  AND jurisdiction_code=jurisdiction AND kind='estimate_authorization' AND status='approved';
 IF NOT FOUND OR NEW.snapshot->'authorizationPolicy' IS DISTINCT FROM jsonb_build_object('id',p.id,'version',p.version,'jurisdictionCode',p.jurisdiction_code,'body',p.body,'bodySha256',p.body_sha256)
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: approved authorization policy required'; END IF;
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION app.read_estimate(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',e.id,'version',e.version,'supplementReason',e.supplement_reason,'snapshot',e.snapshot,
  'estimateSha256',encode(sha256(convert_to(e.snapshot::text,'UTF8')),'hex'),'expiresAt',e.expires_at,
  'authorization',(SELECT jsonb_build_object('signerName',a.signer_name,'approvedLineIds',a.approved_line_ids,'signedAt',a.created_at,'consentText',a.consent_text) FROM app.estimate_authorization a WHERE a.version_id=e.id))
 FROM app.estimate_version e WHERE e.token_hash=p_hash AND e.revoked_at IS NULL AND e.expires_at>now()
 AND (EXISTS(SELECT 1 FROM app.estimate_authorization a WHERE a.version_id=e.id)
  OR (e.snapshot->'authorizationPolicy'->>'source'='shop' AND e.snapshot->'authorizationPolicy'=app.shop_authorization_policy(e.business_id,(e.snapshot->'authorizationPolicy'->>'id')::uuid))
  OR EXISTS(SELECT 1 FROM app.legal_policy p WHERE p.id=(e.snapshot->'authorizationPolicy'->>'id')::uuid AND p.status='approved' AND p.kind='estimate_authorization' AND p.body_sha256=e.snapshot->'authorizationPolicy'->>'bodySha256'))
$$;
CREATE OR REPLACE FUNCTION app.authorize_estimate(p_hash text,p_name text,p_decisions jsonb,p_ip text,p_request text,p_agent text,p_strokes jsonb,p_estimate_hash text,p_signed_at timestamptz,p_pdf text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.estimate_version; p app.legal_policy; resolved jsonb; shop_policy uuid; result uuid; ids jsonb; s jsonb; pt jsonb; point_count integer:=0;
BEGIN
 IF app.current_actor_type() IS DISTINCT FROM 'customer' THEN RAISE EXCEPTION 'INVALID_TRANSITION: customer authorization context required'; END IF;
 SELECT * INTO e FROM app.estimate_version WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR e.revoked_at IS NOT NULL OR e.expires_at<=now() THEN RAISE EXCEPTION 'INVALID_TRANSITION: estimate unavailable'; END IF;
 IF e.snapshot->'authorizationPolicy'->>'source'='shop' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('shop-authorization:'||e.business_id::text,0));
  shop_policy:=(e.snapshot->'authorizationPolicy'->>'id')::uuid;
  resolved:=app.shop_authorization_policy(e.business_id,shop_policy);
 ELSE
  SELECT * INTO p FROM app.legal_policy WHERE id=(e.snapshot->'authorizationPolicy'->>'id')::uuid AND status='approved' AND kind='estimate_authorization' FOR SHARE;
  IF FOUND THEN resolved:=jsonb_build_object('id',p.id,'version',p.version,'jurisdictionCode',p.jurisdiction_code,'body',p.body,'bodySha256',p.body_sha256); END IF;
 END IF;
 IF resolved IS NULL OR e.snapshot->'authorizationPolicy' IS DISTINCT FROM resolved
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: enabled authorization terms required'; END IF;
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
 INSERT INTO app.estimate_authorization(business_id,version_id,signer_name,approved_line_ids,consent_text,ip,request_id,created_at,user_agent,estimate_sha256,policy_id,shop_policy_id,policy_version,policy_sha256,line_decisions,signature_strokes,evidence_pdf_base64,evidence_pdf_sha256)
 VALUES(e.business_id,e.id,btrim(p_name),ids,resolved->>'body',p_ip,p_request,p_signed_at,p_agent,p_estimate_hash,CASE WHEN shop_policy IS NULL THEN p.id ELSE NULL END,shop_policy,(resolved->>'version')::integer,resolved->>'bodySha256',p_decisions,p_strokes,p_pdf,encode(sha256(decode(p_pdf,'base64')),'hex')) RETURNING id INTO result;
 INSERT INTO app.activity(business_id,kind,subject_type,subject_id,actor_type,summary,data)
 VALUES(e.business_id,'estimate.authorized',CASE WHEN e.vehicle_id IS NULL THEN 'customer' ELSE 'vehicle' END,coalesce(e.vehicle_id,e.customer_id),'customer','Estimate authorization recorded',jsonb_build_object('versionId',e.id,'authorizationId',result));
 INSERT INTO app.audit_event(business_id,actor_type,action,target_type,target_id,request_id,"after")
 VALUES(e.business_id,'customer','estimate.authorized','estimate_version',e.id,p_request,jsonb_build_object('authorizationId',result,'approvedLineIds',ids,'policyId',resolved->>'id','policySource',coalesce(resolved->>'source','platform'),'estimateSha256',p_estimate_hash));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.authorize_estimate(text,text,jsonb,text,text,text,jsonb,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_estimate(text,text,jsonb,text,text,text,jsonb,text,timestamptz,text) TO app_user;
