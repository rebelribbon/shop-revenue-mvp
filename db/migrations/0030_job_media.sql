-- Photos and videos from the field: before/after, issues found, and pictures of
-- what's being quoted. Only items switched on are ever shown to the customer.
ALTER TABLE app.file DROP CONSTRAINT file_kind_check;
--> statement-breakpoint
ALTER TABLE app.file ADD CONSTRAINT file_kind_check CHECK (kind IN ('estimate_photo','signature','estimate_pdf','invoice_pdf','authorization_pdf','logo','import_source','export','job_media'));
--> statement-breakpoint
CREATE TABLE app.job_media (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL, job_id uuid, vehicle_id uuid, service_asset_id uuid, appointment_id uuid,
 file_id uuid NOT NULL,
 media_type text NOT NULL CHECK (media_type IN ('photo','video')),
 tag text NOT NULL CHECK (tag IN ('before','after','issue','quote','other')),
 caption text CHECK (caption IS NULL OR length(caption) <= 500),
 show_customer boolean NOT NULL DEFAULT false,
 deleted_at timestamptz,
 UNIQUE (business_id, id), UNIQUE (business_id, file_id),
 FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id),
 FOREIGN KEY (business_id, file_id) REFERENCES app.file(business_id, id)
);
--> statement-breakpoint
CREATE INDEX job_media_customer_idx ON app.job_media(business_id, customer_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX job_media_job_idx ON app.job_media(business_id, job_id) WHERE job_id IS NOT NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.job_media');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.job_media TO app_user;
--> statement-breakpoint
GRANT UPDATE (job_id, tag, caption, show_customer, deleted_at, updated_at) ON app.job_media TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.job_media TO worker_user, admin_user;
--> statement-breakpoint
-- Lets the link-checking functions below (SECURITY DEFINER) read these rows.
CREATE POLICY media_capability ON app.job_media FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
CREATE POLICY file_capability ON app.file FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
-- Customers see a file only through a live estimate/invoice link that includes it.
CREATE FUNCTION app.public_media_key(p_hash text, p_file uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT f.storage_key FROM app.file f
 WHERE f.id = p_file AND f.status = 'ready' AND (
  EXISTS (SELECT 1 FROM app.estimate_version e WHERE e.token_hash = p_hash AND e.business_id = f.business_id AND e.revoked_at IS NULL AND e.expires_at > now()
          AND e.snapshot -> 'photos' @> jsonb_build_array(jsonb_build_object('fileId', p_file::text)))
  OR EXISTS (SELECT 1 FROM app.invoice i JOIN app.job_media m ON m.business_id = i.business_id AND m.job_id = i.quote_id
          WHERE i.token_hash = p_hash AND i.expires_at > now() AND m.file_id = p_file AND m.show_customer AND m.deleted_at IS NULL)
 )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_media_key(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_media_key(text, uuid) TO app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.read_invoice(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('onlinePaymentEnabled',EXISTS(SELECT 1 FROM app.stripe_connection c WHERE c.business_id=i.business_id AND c.account_id IS NOT NULL AND c.card_payments_status='active'),'number',i.number,'snapshot',i.snapshot,'issuedAt',i.created_at,'dueOn',i.due_on,'terms',i.invoice_terms,'voided',i.voided_at IS NOT NULL,'totalCents',i.total_cents,'paidCents',coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0),
  'displayTemplate',(SELECT b.invoice_display FROM app.business b WHERE b.id=i.business_id),'display',i.display,
  'photos',coalesce((SELECT jsonb_agg(jsonb_build_object('fileId',m.file_id,'mediaType',m.media_type,'tag',m.tag,'caption',m.caption) ORDER BY m.created_at)
     FROM app.job_media m JOIN app.file f ON f.business_id=m.business_id AND f.id=m.file_id AND f.status='ready'
     WHERE m.business_id=i.business_id AND m.job_id=i.quote_id AND m.show_customer AND m.deleted_at IS NULL),'[]'::jsonb))
 FROM app.invoice i WHERE i.token_hash=p_hash AND i.expires_at>now()
$$;
