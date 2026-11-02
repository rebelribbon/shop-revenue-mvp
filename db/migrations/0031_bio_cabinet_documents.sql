-- Customer bio address, private attachments, and the job file cabinet with
-- owner-built document templates customers fill in and e-sign.
ALTER TABLE app.customer ADD COLUMN address_line1 text, ADD COLUMN address_line2 text, ADD COLUMN city text, ADD COLUMN region text, ADD COLUMN postal_code text;
--> statement-breakpoint
GRANT UPDATE (address_line1, address_line2, city, region, postal_code) ON app.customer TO app_user;
--> statement-breakpoint
ALTER TABLE app.file DROP CONSTRAINT file_kind_check;
--> statement-breakpoint
ALTER TABLE app.file ADD CONSTRAINT file_kind_check CHECK (kind IN ('estimate_photo','signature','estimate_pdf','invoice_pdf','authorization_pdf','logo','import_source','export','job_media','document'));
--> statement-breakpoint
CREATE TABLE app.document_template (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
 fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 archived_at timestamptz,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.document_template');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.document_template TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, body, fields, archived_at, updated_at) ON app.document_template TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.document_template TO worker_user, admin_user;
--> statement-breakpoint
-- One row per item in a customer's attachments or a job's file cabinet.
-- kind: 'upload' (a file someone added) or 'esign' (a template sent to sign).
CREATE TABLE app.document (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL, job_id uuid,
 kind text NOT NULL CHECK (kind IN ('upload','esign')),
 category text NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 file_id uuid,
 template_id uuid,
 -- e-sign: the exact text sent (merge fields filled), the fields to complete,
 -- the link, and the signer's evidence once signed.
 body text, fields jsonb, token_hash text UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'), share_token_ciphertext text, expires_at timestamptz,
 status text NOT NULL DEFAULT 'filed' CHECK (status IN ('filed','sent','signed','void')),
 body_sha256 text, values jsonb, signer_name text, signed_at timestamptz, ip text, user_agent text, request_id text,
 signature_strokes jsonb, evidence_pdf_base64 text, evidence_pdf_sha256 text,
 voided_at timestamptz, void_reason text, deleted_at timestamptz,
 UNIQUE (business_id, id),
 FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id),
 FOREIGN KEY (business_id, file_id) REFERENCES app.file(business_id, id),
 FOREIGN KEY (business_id, template_id) REFERENCES app.document_template(business_id, id),
 CHECK ((kind = 'upload') = (file_id IS NOT NULL AND token_hash IS NULL)),
 CHECK (kind <> 'esign' OR (body IS NOT NULL AND fields IS NOT NULL AND token_hash IS NOT NULL AND job_id IS NOT NULL)),
 CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND evidence_pdf_sha256 IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX document_customer_idx ON app.document(business_id, customer_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX document_job_idx ON app.document(business_id, job_id, created_at DESC) WHERE job_id IS NOT NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.document');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.document TO app_user;
--> statement-breakpoint
GRANT UPDATE (title, category, status, voided_at, void_reason, deleted_at, token_hash, share_token_ciphertext, expires_at, updated_at) ON app.document TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.document TO worker_user, admin_user;
--> statement-breakpoint
-- Signed evidence never changes after signing.
CREATE FUNCTION app.guard_signed_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF OLD.status = 'signed' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.values IS DISTINCT FROM OLD.values OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
   OR NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.evidence_pdf_base64 IS DISTINCT FROM OLD.evidence_pdf_base64 OR NEW.signature_strokes IS DISTINCT FROM OLD.signature_strokes
   OR NEW.status NOT IN ('signed','void')) THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: a signed document cannot be changed';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_signed BEFORE UPDATE ON app.document FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document();
--> statement-breakpoint
-- The link functions below (SECURITY DEFINER) read and sign by token only.
CREATE POLICY document_capability_read ON app.document FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
CREATE POLICY document_capability_sign ON app.document FOR UPDATE TO migration_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
-- What the customer sees from their link (no internal notes or other files).
CREATE FUNCTION app.read_document(p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('id',d.id,'title',d.title,'body',d.body,'fields',d.fields,'status',d.status,'expiresAt',d.expires_at,
  'shopName',(SELECT coalesce(b.dba,b.legal_name) FROM app.business b WHERE b.id=d.business_id),
  'signerName',d.signer_name,'signedAt',d.signed_at,'values',d.values)
 FROM app.document d WHERE d.token_hash=p_hash AND d.kind='esign' AND d.status IN ('sent','signed') AND d.deleted_at IS NULL AND (d.status='signed' OR d.expires_at>now())
$$;
--> statement-breakpoint
CREATE FUNCTION app.sign_document(p_hash text,p_name text,p_values jsonb,p_strokes jsonb,p_ip text,p_agent text,p_request text,p_body_sha text,p_signed_at timestamptz,p_pdf text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE d app.document;
BEGIN
 SELECT * INTO d FROM app.document WHERE token_hash=p_hash AND kind='esign' FOR UPDATE;
 IF NOT FOUND OR d.status<>'sent' OR d.expires_at<=now() OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION: document unavailable'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'INVALID_TRANSITION: name required'; END IF;
 IF p_body_sha IS DISTINCT FROM encode(sha256(convert_to(d.body,'UTF8')),'hex') THEN RAISE EXCEPTION 'INVALID_TRANSITION: document changed'; END IF;
 IF p_pdf IS NULL OR length(p_pdf) NOT BETWEEN 100 AND 8000000 OR substring(decode(p_pdf,'base64') from 1 for 5)<>convert_to('%PDF-','UTF8') THEN RAISE EXCEPTION 'INVALID_TRANSITION: evidence required'; END IF;
 UPDATE app.document SET status='signed', signer_name=btrim(p_name), values=p_values, signature_strokes=p_strokes, ip=p_ip, user_agent=p_agent, request_id=p_request,
  signed_at=p_signed_at, body_sha256=p_body_sha, evidence_pdf_base64=p_pdf, evidence_pdf_sha256=encode(sha256(decode(p_pdf,'base64')),'hex'), updated_at=now()
  WHERE id=d.id;
 PERFORM set_config('app.business_id', d.business_id::text, true);
 INSERT INTO app.activity(business_id,kind,subject_type,subject_id,actor_type,summary,data)
  VALUES(d.business_id,'document.signed','customer',d.customer_id,'customer','Signed: '||d.title,jsonb_build_object('documentId',d.id,'jobId',d.job_id));
 RETURN d.id;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.read_document_pdf(p_hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT d.evidence_pdf_base64 FROM app.document d WHERE d.token_hash=p_hash AND d.status='signed'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.read_document(text), app.sign_document(text,text,jsonb,jsonb,text,text,text,text,timestamptz,text), app.read_document_pdf(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.read_document(text), app.sign_document(text,text,jsonb,jsonb,text,text,text,text,timestamptz,text), app.read_document_pdf(text) TO app_user;
