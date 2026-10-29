-- Milestone 1 security layer (Sections 8 and 9). Hand-written; reviewed as SQL.
-- RLS policies, grants, invariant triggers and SECURITY DEFINER resolvers.
--
-- Roles: app_user (web), worker_user (worker), admin_user (/admin). None owns
-- anything or bypasses RLS. migration_owner owns everything and never connects
-- at runtime; SECURITY DEFINER functions run as it, so FORCE ROW LEVEL SECURITY
-- binds it too and each table it must read gets an explicit owner policy.

-- ---------------------------------------------------------------------------
-- Circular reference: business.logo_file_id -> file (business_id, id)
-- ---------------------------------------------------------------------------
ALTER TABLE app.business
  ADD CONSTRAINT business_logo_file_fk FOREIGN KEY (id, logo_file_id) REFERENCES app.file (business_id, id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY array['business', 'user', 'location', 'membership', 'internal_user', 'support_session',
                           'activity', 'audit_event', 'request_idempotency', 'file', 'webhook_event', 'legal_policy']
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Standard tenant RLS (Section 9), reused by every later migration that adds a
-- tenant table: ENABLE + FORCE, one isolation policy keyed on app.business_id
-- with the same WITH CHECK, and restrictive policies that make support view-as
-- read-only at the database (actor_type = 'support' can never write).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.apply_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s FOR ALL TO app_user, worker_user, admin_user '
    'USING (business_id = app.current_business_id()) WITH CHECK (business_id = app.current_business_id())', tbl);
  PERFORM app.apply_support_read_only(tbl);
END
$$;
--> statement-breakpoint
CREATE FUNCTION app.apply_support_read_only(tbl regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('CREATE POLICY support_read_only_insert ON %s AS RESTRICTIVE FOR INSERT TO app_user, worker_user, admin_user '
                 'WITH CHECK (app.current_actor_type() IS DISTINCT FROM ''support'')', tbl);
  EXECUTE format('CREATE POLICY support_read_only_update ON %s AS RESTRICTIVE FOR UPDATE TO app_user, worker_user, admin_user '
                 'USING (app.current_actor_type() IS DISTINCT FROM ''support'')', tbl);
  EXECUTE format('CREATE POLICY support_read_only_delete ON %s AS RESTRICTIVE FOR DELETE TO app_user, worker_user, admin_user '
                 'USING (app.current_actor_type() IS DISTINCT FROM ''support'')', tbl);
END
$$;
--> statement-breakpoint

SELECT app.apply_tenant_rls('app.location');
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.membership');
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.activity');
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.request_idempotency');
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.file');
--> statement-breakpoint

-- audit_event: tenant rows isolate exactly like any tenant table. Platform rows
-- (business_id NULL; internal or system actors only, by CHECK) are visible and
-- insertable only by worker_user/admin_user outside any tenant context. The
-- support read-only rule has one exception: view-as writes its own audit rows.
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.audit_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON app.audit_event FOR ALL TO app_user
  USING (business_id = app.current_business_id()) WITH CHECK (business_id = app.current_business_id());
--> statement-breakpoint
CREATE POLICY tenant_or_platform ON app.audit_event FOR ALL TO worker_user, admin_user
  USING (business_id IS NOT DISTINCT FROM app.current_business_id())
  WITH CHECK (business_id IS NOT DISTINCT FROM app.current_business_id());
--> statement-breakpoint
CREATE POLICY support_audit_only ON app.audit_event AS RESTRICTIVE FOR INSERT TO app_user, worker_user, admin_user
  WITH CHECK (app.current_actor_type() IS DISTINCT FROM 'support'
              OR (actor_type = 'support' AND support_session_id IS NOT NULL));
--> statement-breakpoint

-- business (global root, is the tenant): a tenant sees only itself; admin sees all.
ALTER TABLE app.business ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.business FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_business ON app.business FOR ALL TO app_user, worker_user
  USING (id = app.current_business_id()) WITH CHECK (id = app.current_business_id());
--> statement-breakpoint
CREATE POLICY admin_all ON app.business FOR ALL TO admin_user USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY definer_read ON app.business FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
SELECT app.apply_support_read_only('app.business');
--> statement-breakpoint

-- user (global): explicit read policy. A signed-in person sees their own row and
-- the members of the current business; writes only to their own row.
ALTER TABLE app."user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app."user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY self_or_member_read ON app."user" FOR SELECT TO app_user, worker_user, admin_user
  USING (auth_provider_id = app.current_auth_subject()
         OR id IN (SELECT m.user_id FROM app.membership m WHERE m.business_id = app.current_business_id()));
--> statement-breakpoint
CREATE POLICY self_insert ON app."user" FOR INSERT TO app_user
  WITH CHECK (auth_provider_id = app.current_auth_subject());
--> statement-breakpoint
CREATE POLICY self_update ON app."user" FOR UPDATE TO app_user
  USING (auth_provider_id = app.current_auth_subject()) WITH CHECK (auth_provider_id = app.current_auth_subject());
--> statement-breakpoint
CREATE POLICY definer_read ON app."user" FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
SELECT app.apply_support_read_only('app."user"');
--> statement-breakpoint

-- Owner policies used only by the SECURITY DEFINER resolvers below.
CREATE POLICY definer_read ON app.membership FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint

-- internal_user (global): never readable by app_user or worker_user.
ALTER TABLE app.internal_user ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.internal_user FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_all ON app.internal_user FOR ALL TO admin_user USING (true) WITH CHECK (true);
--> statement-breakpoint

-- support_session (global, carries business_id; spec issue 2): forced RLS with
-- role-specific policies. The shop reads its own sessions (S29); the admin
-- console creates and ends them; the worker closes expired ones.
ALTER TABLE app.support_session ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.support_session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON app.support_session FOR SELECT TO app_user
  USING (business_id = app.current_business_id());
--> statement-breakpoint
CREATE POLICY worker_expire ON app.support_session FOR ALL TO worker_user USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY admin_all ON app.support_session FOR ALL TO admin_user USING (true) WITH CHECK (true);
--> statement-breakpoint

-- webhook_event (global inbox, carries business_id once resolved; spec issue 2):
-- forced RLS; no app_user policy or grant at all (ingest goes through a definer).
ALTER TABLE app.webhook_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.webhook_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY worker_all ON app.webhook_event FOR ALL TO worker_user USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY admin_read_replay ON app.webhook_event FOR ALL TO admin_user USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY definer_ingest ON app.webhook_event FOR ALL TO migration_owner USING (true) WITH CHECK (true);
--> statement-breakpoint

-- legal_policy (global): explicit read policy. Shops read approved and retired
-- versions (retired ones stay referenced by old documents); drafts are admin-only.
ALTER TABLE app.legal_policy ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.legal_policy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY published_read ON app.legal_policy FOR SELECT TO app_user, worker_user
  USING (status IN ('approved', 'retired'));
--> statement-breakpoint
CREATE POLICY admin_all ON app.legal_policy FOR ALL TO admin_user USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants. Column lists restrict what each role may change.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.current_business_id(), app.current_actor_type(),
  app.current_actor_id(), app.current_auth_subject() TO app_user, worker_user, admin_user;
--> statement-breakpoint

GRANT SELECT ON app.business TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT UPDATE (legal_name, dba, phone_e164, address_line1, address_line2, city, region, postal_code, timezone,
              tax_rate_bps, logo_file_id) ON app.business TO app_user;
--> statement-breakpoint
GRANT INSERT, UPDATE ON app.business TO admin_user;
--> statement-breakpoint

GRANT SELECT ON app.location TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT INSERT ON app.location TO admin_user;
--> statement-breakpoint
GRANT UPDATE (name, address_line1, address_line2, city, region, postal_code) ON app.location TO app_user, admin_user;
--> statement-breakpoint

GRANT SELECT ON app."user" TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT INSERT (auth_provider_id, email, phone_e164, display_name, mfa_phone_e164) ON app."user" TO app_user;
--> statement-breakpoint
GRANT UPDATE (email, phone_e164, display_name, mfa_phone_e164) ON app."user" TO app_user;
--> statement-breakpoint

GRANT SELECT ON app.membership TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT INSERT ON app.membership TO app_user, admin_user;
--> statement-breakpoint
GRANT UPDATE (user_id, status, invite_name, invite_email, invite_phone_e164, invite_token_hash, invite_expires_at,
              activated_at, removed_at) ON app.membership TO app_user, admin_user;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON app.internal_user TO admin_user;
--> statement-breakpoint

GRANT SELECT ON app.support_session TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT INSERT (admin_user_id, business_id, reason) ON app.support_session TO admin_user;
--> statement-breakpoint
GRANT UPDATE (ended_at, end_reason) ON app.support_session TO worker_user, admin_user;
--> statement-breakpoint

-- Evidence is append-only (Section 8): INSERT and SELECT only, for every role.
GRANT SELECT, INSERT ON app.activity, app.audit_event TO app_user, worker_user, admin_user;
--> statement-breakpoint

GRANT SELECT, INSERT ON app.request_idempotency TO app_user, admin_user;
--> statement-breakpoint
GRANT SELECT, DELETE ON app.request_idempotency TO worker_user;
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON app.file TO app_user;
--> statement-breakpoint
GRANT UPDATE (status, sha256, byte_size, content_type) ON app.file TO app_user, worker_user;
--> statement-breakpoint
GRANT SELECT, DELETE ON app.file TO worker_user;
--> statement-breakpoint
GRANT SELECT ON app.file TO admin_user;
--> statement-breakpoint

GRANT SELECT ON app.webhook_event TO worker_user, admin_user;
--> statement-breakpoint
GRANT UPDATE (business_id, status, attempts, last_error, applied_at, next_attempt_at) ON app.webhook_event TO worker_user;
--> statement-breakpoint
GRANT UPDATE (status, next_attempt_at) ON app.webhook_event TO admin_user;
--> statement-breakpoint

GRANT SELECT ON app.legal_policy TO app_user, worker_user, admin_user;
--> statement-breakpoint
GRANT INSERT (jurisdiction_code, kind, version, body, created_by_internal_user_id) ON app.legal_policy TO admin_user;
--> statement-breakpoint
GRANT UPDATE (body, status, approved_by, approved_at, approval_reference, retired_at) ON app.legal_policy TO admin_user;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Invariant triggers
-- ---------------------------------------------------------------------------

-- Append-only evidence: no UPDATE, DELETE or TRUNCATE for anyone, owner included.
CREATE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.audit_event FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.audit_event FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.activity FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.activity FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE ON app.request_idempotency FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint

-- Membership (Section 8): max one active owner (partial unique index), one staff
-- seat (partial unique index), max two active members (this trigger), and the
-- invited -> active | removed, active -> removed state machine.
CREATE FUNCTION app.membership_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  active_count int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.business_id <> OLD.business_id OR NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'IMMUTABLE: membership business_id and role cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'IMMUTABLE: membership user_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'invited' AND NEW.status IN ('active', 'removed'))
      OR (OLD.status = 'active' AND NEW.status = 'removed')) THEN
      PERFORM app.raise_invalid_transition('membership', OLD.status, NEW.status);
    END IF;
  ELSIF NEW.status = 'removed' THEN
    PERFORM app.raise_invalid_transition('membership', '(new)', NEW.status);
  END IF;

  IF NEW.status = 'active' THEN
    NEW.activated_at := coalesce(NEW.activated_at, now());
    NEW.invite_token_hash := NULL;
  ELSIF NEW.status = 'removed' THEN
    NEW.removed_at := coalesce(NEW.removed_at, now());
    NEW.invite_token_hash := NULL;
  END IF;

  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    -- Serialize activations per business so concurrent accepts cannot both pass.
    PERFORM pg_advisory_xact_lock(hashtextextended('app.membership:' || NEW.business_id::text, 0));
    SELECT count(*) INTO active_count FROM app.membership
     WHERE business_id = NEW.business_id AND status = 'active' AND id <> NEW.id;
    IF active_count >= 2 THEN
      RAISE EXCEPTION 'MEMBERSHIP_LIMIT: a business has at most two active members' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER membership_guard BEFORE INSERT OR UPDATE ON app.membership FOR EACH ROW EXECUTE FUNCTION app.membership_guard();
--> statement-breakpoint
CREATE TRIGGER membership_no_delete BEFORE DELETE ON app.membership FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint

-- support_session: append-only except ending it once; 60 minutes, set by the database.
CREATE FUNCTION app.support_session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_at := now();
    NEW.expires_at := NEW.started_at + interval '60 minutes';
    NEW.ended_at := NULL;
    NEW.end_reason := NULL;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY: support session already ended' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.admin_user_id, NEW.business_id, NEW.reason, NEW.started_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.admin_user_id, OLD.business_id, OLD.reason, OLD.started_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'APPEND_ONLY: support session fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER support_session_guard BEFORE INSERT OR UPDATE ON app.support_session FOR EACH ROW EXECUTE FUNCTION app.support_session_guard();
--> statement-breakpoint
CREATE TRIGGER support_session_no_delete BEFORE DELETE ON app.support_session FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint

-- legal_policy: draft -> approved -> retired; body frozen once approved; never deleted.
CREATE FUNCTION app.legal_policy_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      PERFORM app.raise_invalid_transition('legal_policy', '(new)', NEW.status);
    END IF;
  ELSE
    IF (NEW.jurisdiction_code, NEW.kind, NEW.version, NEW.created_by_internal_user_id)
       IS DISTINCT FROM (OLD.jurisdiction_code, OLD.kind, OLD.version, OLD.created_by_internal_user_id) THEN
      RAISE EXCEPTION 'IMMUTABLE: legal policy identity cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status <> 'draft' AND NEW.body IS DISTINCT FROM OLD.body THEN
      RAISE EXCEPTION 'IMMUTABLE: approved legal policy text cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.approved_by, NEW.approved_at, NEW.approval_reference)
       IS DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.approval_reference) THEN
      RAISE EXCEPTION 'IMMUTABLE: legal policy approval cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'draft' AND NEW.status = 'approved')
      OR (OLD.status = 'approved' AND NEW.status = 'retired')) THEN
      PERFORM app.raise_invalid_transition('legal_policy', OLD.status, NEW.status);
    END IF;
  END IF;
  NEW.body_sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER legal_policy_guard BEFORE INSERT OR UPDATE ON app.legal_policy FOR EACH ROW EXECUTE FUNCTION app.legal_policy_guard();
--> statement-breakpoint
CREATE TRIGGER legal_policy_no_delete BEFORE DELETE ON app.legal_policy FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint

-- file: identity immutable; pending -> ready | quarantined.
CREATE FUNCTION app.file_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.business_id, NEW.storage_key, NEW.kind) IS DISTINCT FROM (OLD.business_id, OLD.storage_key, OLD.kind) THEN
    RAISE EXCEPTION 'IMMUTABLE: file identity cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'pending' AND NEW.status IN ('ready', 'quarantined')) THEN
    PERFORM app.raise_invalid_transition('file', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER file_guard BEFORE UPDATE ON app.file FOR EACH ROW EXECUTE FUNCTION app.file_guard();
--> statement-breakpoint

-- webhook_event: provider identity and payload are immutable once stored.
CREATE FUNCTION app.webhook_event_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.provider, NEW.provider_event_id, NEW.event_type, NEW.payload, NEW.received_at)
     IS DISTINCT FROM (OLD.provider, OLD.provider_event_id, OLD.event_type, OLD.payload, OLD.received_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: webhook event payload cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'IMMUTABLE: webhook event business cannot change once resolved' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER webhook_event_guard BEFORE UPDATE ON app.webhook_event FOR EACH ROW EXECUTE FUNCTION app.webhook_event_guard();
--> statement-breakpoint
CREATE TRIGGER webhook_event_no_delete BEFORE DELETE ON app.webhook_event FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER resolvers: the only queries that run without tenant context.
-- Each returns the minimum needed to open a tenant-scoped transaction.
-- ---------------------------------------------------------------------------

-- Session -> memberships (Section 9). The caller passes the verified auth subject.
CREATE FUNCTION app.resolve_memberships(p_auth_subject uuid)
RETURNS TABLE (user_id uuid, user_status text, membership_id uuid, business_id uuid, role text, status text,
               business_status text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.id, u.status, m.id, m.business_id, m.role, m.status, b.status
    FROM app."user" u
    JOIN app.membership m ON m.user_id = u.id
    JOIN app.business b ON b.id = m.business_id
   WHERE u.auth_provider_id = p_auth_subject
$$;
--> statement-breakpoint

-- Invite token hash -> the invited membership. Unknown and used tokens look the same.
CREATE FUNCTION app.resolve_invite(p_token_hash text)
RETURNS TABLE (membership_id uuid, business_id uuid, role text, invite_email text, invite_phone_e164 text,
               invite_expires_at timestamptz, business_name text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT m.id, m.business_id, m.role, m.invite_email, m.invite_phone_e164, m.invite_expires_at,
         coalesce(b.dba, b.legal_name)
    FROM app.membership m
    JOIN app.business b ON b.id = m.business_id
   WHERE m.invite_token_hash = p_token_hash
     AND m.status = 'invited'
     AND b.status = 'active'
$$;
--> statement-breakpoint

-- Enqueue a Graphile Worker job in the caller's transaction (Section 18). Payloads
-- for tenant work must carry the transaction's business_id; a payload naming a
-- different business is refused (Section 9: worker job for A with B's IDs fails).
CREATE FUNCTION app.enqueue_job(p_task text, p_payload jsonb, p_run_at timestamptz DEFAULT NULL,
                                p_max_attempts int DEFAULT NULL, p_job_key text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  ctx uuid := app.current_business_id();
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  job_id bigint;
BEGIN
  IF p_task !~ '^[a-z_]+$' THEN
    RAISE EXCEPTION 'enqueue_job: invalid task name %', p_task USING ERRCODE = '22023';
  END IF;
  IF payload ? 'business_id' AND (payload->>'business_id')::uuid IS DISTINCT FROM ctx THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: job payload business_id does not match the transaction tenant'
      USING ERRCODE = '42501';
  END IF;
  IF ctx IS NOT NULL THEN
    payload := payload || jsonb_build_object('business_id', ctx);
  END IF;
  SELECT (graphile_worker.add_job(p_task, payload::json, run_at => p_run_at, max_attempts => p_max_attempts,
                                  job_key => p_job_key)).id INTO job_id;
  RETURN job_id;
END
$$;
--> statement-breakpoint

-- Store a signature-verified webhook first (F32), then enqueue its processing in
-- the same transaction. A duplicate provider event ID is acknowledged and ignored.
CREATE FUNCTION app.ingest_webhook_event(p_provider text, p_provider_event_id text, p_event_type text, p_payload jsonb)
RETURNS TABLE (event_id uuid, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO app.webhook_event (provider, provider_event_id, event_type, payload, signature_valid)
  VALUES (p_provider, p_provider_event_id, p_event_type, p_payload, true)
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN
    RETURN QUERY SELECT w.id, true FROM app.webhook_event w
                  WHERE w.provider = p_provider AND w.provider_event_id = p_provider_event_id;
    RETURN;
  END IF;
  PERFORM graphile_worker.add_job('process_webhook_event', json_build_object('webhook_event_id', new_id),
                                  max_attempts => 1, job_key => 'webhook:' || new_id::text);
  RETURN QUERY SELECT new_id, false;
END
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.resolve_memberships(uuid), app.resolve_invite(text),
  app.ingest_webhook_event(text, text, text, jsonb) TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enqueue_job(text, jsonb, timestamptz, int, text) TO app_user, worker_user, admin_user;
