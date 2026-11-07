-- OAuth connects an existing full-Dashboard Stripe account without copying keys.
ALTER TABLE app.stripe_connection ADD COLUMN connection_method text NOT NULL DEFAULT 'hosted'
 CHECK (connection_method IN ('hosted','oauth'));
--> statement-breakpoint
CREATE TABLE app.stripe_oauth_attempt (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id uuid REFERENCES app."user"(id), owner_id uuid NOT NULL REFERENCES app."user"(id),
 state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
 livemode boolean NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 UNIQUE (business_id,id), CHECK (expires_at>created_at)
);
--> statement-breakpoint
CREATE INDEX stripe_oauth_owner_expiry ON app.stripe_oauth_attempt(business_id,owner_id,expires_at);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.stripe_oauth_attempt');
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON app.stripe_oauth_attempt TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.stripe_oauth_attempt TO admin_user;
--> statement-breakpoint
CREATE POLICY oauth_owner ON app.stripe_oauth_attempt AS RESTRICTIVE FOR ALL TO app_user
 USING (owner_id=app.current_actor_id() AND app.current_actor_type()='user' AND EXISTS (
  SELECT 1 FROM app.membership m WHERE m.business_id=stripe_oauth_attempt.business_id
   AND m.user_id=app.current_actor_id() AND m.role='owner' AND m.status='active'))
 WITH CHECK (owner_id=app.current_actor_id() AND app.current_actor_type()='user' AND EXISTS (
  SELECT 1 FROM app.membership m WHERE m.business_id=stripe_oauth_attempt.business_id
   AND m.user_id=app.current_actor_id() AND m.role='owner' AND m.status='active'));
--> statement-breakpoint
CREATE FUNCTION app.guard_stripe_oauth_attempt() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.business_id,NEW.owner_id,NEW.state_hash,NEW.livemode,NEW.expires_at,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.business_id,OLD.owner_id,OLD.state_hash,OLD.livemode,OLD.expires_at,OLD.created_at) THEN
  RAISE EXCEPTION 'IMMUTABLE: Stripe authorization attempt identity';
 END IF;
 IF TG_OP='UPDATE' AND OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
  RAISE EXCEPTION 'IMMUTABLE: Stripe authorization attempt was consumed';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_identity BEFORE UPDATE ON app.stripe_oauth_attempt
 FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_oauth_attempt();
