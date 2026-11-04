-- Customer link: one private link per customer showing their estimates to
-- approve, invoices to pay, papers to sign, upcoming visits and history.
CREATE TABLE app.customer_portal (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 share_token_ciphertext text NOT NULL,
 revoked_at timestamptz,
 UNIQUE (business_id, id),
 FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_portal_one_live ON app.customer_portal(business_id, customer_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.customer_portal');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.customer_portal TO app_user;
--> statement-breakpoint
GRANT UPDATE (revoked_at, updated_at) ON app.customer_portal TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.customer_portal TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.customer_portal FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE POLICY portal_capability ON app.customer_portal FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
CREATE POLICY portal_appointments ON app.appointment FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
CREATE POLICY portal_customers ON app.customer FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
-- Everything a customer may see, found by their link only. Sealed share
-- tokens are returned so the server (never the browser) can build links.
CREATE FUNCTION app.read_customer_portal(p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 WITH p AS (
  SELECT cp.* FROM app.customer_portal cp WHERE cp.token_hash=p_hash AND cp.revoked_at IS NULL
 ), b AS (
  SELECT bz.* FROM app.business bz JOIN p ON p.business_id=bz.id WHERE bz.status='active'
 ), c AS (
  SELECT cu.* FROM app.customer cu JOIN p ON p.business_id=cu.business_id AND p.customer_id=cu.id WHERE cu.status='active'
 )
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM c) OR NOT EXISTS (SELECT 1 FROM b) THEN NULL ELSE jsonb_build_object(
  'shop', (SELECT jsonb_build_object('name',coalesce(nullif(b.dba,''),b.legal_name),'phone',b.phone_e164,'bookingSlug',b.booking_slug,'timezone',b.timezone) FROM b),
  'customer', (SELECT jsonb_build_object('firstName',c.first_name,'displayName',c.display_name) FROM c),
  'estimates', coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.snapshot->>'title','totalCents',(e.snapshot->>'totalCents')::bigint,
     'createdAt',e.created_at,'expiresAt',e.expires_at,'sealed',e.share_token_ciphertext,
     'approved',EXISTS(SELECT 1 FROM app.estimate_authorization a WHERE a.business_id=e.business_id AND a.version_id=e.id)) ORDER BY e.created_at DESC)
   FROM app.estimate_version e JOIN c ON c.business_id=e.business_id AND c.id=e.customer_id
   WHERE e.revoked_at IS NULL AND e.expires_at>now() AND e.share_token_ciphertext IS NOT NULL
     AND e.version=(SELECT max(x.version) FROM app.estimate_version x WHERE x.business_id=e.business_id AND x.quote_id=e.quote_id)),'[]'::jsonb),
  'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'title',i.snapshot->>'title','totalCents',i.total_cents,
     'paidCents',coalesce((SELECT sum(pm.amount_cents) FROM app.invoice_payment pm WHERE pm.business_id=i.business_id AND pm.invoice_id=i.id),0),
     'createdAt',i.created_at,'sealed',CASE WHEN i.expires_at>now() THEN i.share_token_ciphertext END) ORDER BY i.created_at DESC)
   FROM app.invoice i JOIN c ON c.business_id=i.business_id AND c.id=i.customer_id
   WHERE i.voided_at IS NULL),'[]'::jsonb),
  'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'status',d.status,'sealed',CASE WHEN d.status='sent' AND d.expires_at>now() THEN d.share_token_ciphertext END) ORDER BY d.created_at DESC)
   FROM app.document d JOIN c ON c.business_id=d.business_id AND c.id=d.customer_id
   WHERE d.kind='esign' AND d.deleted_at IS NULL AND d.status IN ('sent','signed')),'[]'::jsonb),
  'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('startsAt',a.starts_at,'reason',a.reason) ORDER BY a.starts_at)
   FROM app.appointment a JOIN c ON c.business_id=a.business_id AND c.id=a.customer_id
   WHERE a.status='scheduled' AND a.starts_at>now()-interval '2 hours'),'[]'::jsonb)
 ) END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.read_customer_portal(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.read_customer_portal(text) TO app_user;
