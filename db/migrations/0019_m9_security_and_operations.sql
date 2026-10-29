-- Index actual foreign-key column prefixes, without indexing vendor/auth schemas.
DO $$ DECLARE ref record; BEGIN
 FOR ref IN
  SELECT c.conname,c.conrelid,c.conkey,n.nspname,t.relname,
   (SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num) cols
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE c.contype='f' AND n.nspname='app' AND NOT EXISTS(
   SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indpred IS NULL
    AND i.indnkeyatts>=cardinality(c.conkey) AND NOT EXISTS(SELECT 1 FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) WHERE i.indkey[(k.ord-1)::integer] IS DISTINCT FROM k.num)
  )
 LOOP EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I(%s)','fk_'||left(ref.relname,30)||'_'||substr(md5(ref.conname),1,10),ref.nspname,ref.relname,ref.cols); END LOOP;
END $$;
-- Preserve the vendor functions, while pinning their resolution to trusted schemas.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='graphile_worker' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
   AND NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) v WHERE v LIKE 'search_path=%')
 LOOP EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,graphile_worker',f.signature); END LOOP;
END $$;
CREATE TABLE app.auth_rate_limit (
 key_hash text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL CHECK(hits>0),
 PRIMARY KEY(key_hash,window_start)
);
ALTER TABLE app.auth_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_rate_limit FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_only ON app.auth_rate_limit FOR ALL TO worker_user USING(app.current_actor_type()='system') WITH CHECK(app.current_actor_type()='system');
GRANT SELECT,INSERT,UPDATE,DELETE ON app.auth_rate_limit TO worker_user;
CREATE INDEX auth_rate_expiry_idx ON app.auth_rate_limit(window_start);
CREATE TABLE app.maintenance_run (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),completed integer NOT NULL DEFAULT 0,failed integer NOT NULL DEFAULT 0
);
ALTER TABLE app.maintenance_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.maintenance_run FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_only ON app.maintenance_run FOR ALL TO worker_user USING(app.current_actor_type()='system') WITH CHECK(app.current_actor_type()='system');
GRANT SELECT,INSERT,UPDATE ON app.maintenance_run TO worker_user;
CREATE INDEX maintenance_run_started_idx ON app.maintenance_run(started_at DESC);
