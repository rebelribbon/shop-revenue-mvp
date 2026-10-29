-- Global maintenance that must cross tenants without loosening tenant RLS:
-- narrow SECURITY DEFINER functions, each doing one fixed thing.

-- purge_request_idempotency (Section 18): rows older than 48 hours.
CREATE POLICY definer_purge ON app.request_idempotency FOR DELETE TO migration_owner USING (true);
--> statement-breakpoint
CREATE POLICY definer_purge_read ON app.request_idempotency FOR SELECT TO migration_owner USING (true);
--> statement-breakpoint
CREATE FUNCTION app.purge_request_idempotency() RETURNS integer
LANGUAGE sql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH d AS (DELETE FROM app.request_idempotency WHERE created_at < now() - interval '48 hours' RETURNING 1)
  SELECT count(*)::int FROM d
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_request_idempotency() TO worker_user;
--> statement-breakpoint

-- Worker liveness for the health route and queue-lag alerting (Sections 18, 20):
-- last heartbeat cron execution and the age of the oldest due, unlocked job.
CREATE FUNCTION app.worker_status()
RETURNS TABLE (last_heartbeat_at timestamptz, oldest_due_job_at timestamptz, due_jobs bigint, failed_jobs bigint)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    (SELECT last_execution FROM graphile_worker._private_known_crontabs WHERE identifier = 'heartbeat'),
    (SELECT min(run_at) FROM graphile_worker._private_jobs WHERE locked_at IS NULL AND run_at <= now() AND attempts < max_attempts),
    (SELECT count(*) FROM graphile_worker._private_jobs WHERE locked_at IS NULL AND run_at <= now() AND attempts < max_attempts),
    (SELECT count(*) FROM graphile_worker._private_jobs WHERE attempts >= max_attempts)
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.worker_status() TO app_user, worker_user, admin_user;
