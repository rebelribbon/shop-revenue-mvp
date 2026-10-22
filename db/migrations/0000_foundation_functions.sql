-- Foundation: the app schema and helper functions every later migration uses.
-- Hand-written (Section 24). Runs as migration_owner.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
-- Functions are executable only where a migration grants them explicitly.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, version 7, variant 10, random rest.
CREATE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;
--> statement-breakpoint

-- Tenant context (Section 9). withTenant() sets these with SET LOCAL inside one
-- transaction; outside such a transaction they are NULL and RLS returns nothing.
CREATE FUNCTION app.current_business_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.business_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app.current_actor_type() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.actor_type', true), '') $$;
--> statement-breakpoint
CREATE FUNCTION app.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;
--> statement-breakpoint
-- The verified Supabase Auth subject of the signed-in person (set by the server
-- from the verified session; never from browser input).
CREATE FUNCTION app.current_auth_subject() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.auth_subject', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Raised for rejected state transitions (Section 6). Error code P0001 with a
-- stable message prefix the app maps to INVALID_TRANSITION.
CREATE FUNCTION app.raise_invalid_transition(entity text, from_state text, to_state text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'INVALID_TRANSITION: % % -> %', entity, from_state, to_state
    USING ERRCODE = 'P0001';
END
$$;
