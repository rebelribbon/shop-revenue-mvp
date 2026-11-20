-- Record a real secure proposal page load without exposing the customer,
-- financial contents, or share token to a public SQL endpoint.
-- The bearer token is validated by the same gated reader used by the page.
CREATE POLICY capability_estimate_open_history ON app.activity
FOR SELECT TO migration_owner
USING (
  kind = 'estimate.customer_opened'
  AND business_id = app.current_business_id()
  AND app.current_actor_type() = 'customer'
);

CREATE OR REPLACE FUNCTION app.record_estimate_open(p_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_estimate app.estimate_version%ROWTYPE;
  v_previous_business text := pg_catalog.current_setting('app.business_id', true);
BEGIN
  IF app.current_actor_type() IS DISTINCT FROM 'customer'
    OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  IF app.read_estimate(p_hash) IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_estimate FROM app.estimate_version e
    WHERE e.token_hash = p_hash
      AND e.revoked_at IS NULL
      AND e.expires_at > pg_catalog.now()
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.set_config('app.business_id', v_estimate.business_id::text, true);
  -- Serialize concurrent opens on the estimate row and deduplicate refreshes.
  IF NOT EXISTS (
    SELECT 1 FROM app.activity a
      WHERE a.business_id = v_estimate.business_id
        AND a.kind = 'estimate.customer_opened'
        AND a.data->>'versionId' = v_estimate.id::text
        AND a.occurred_at > pg_catalog.now() - interval '10 minutes'
  ) THEN
    INSERT INTO app.activity (
      business_id, kind, subject_type, subject_id, actor_type,
      actor_id, summary, data
    ) VALUES (
      v_estimate.business_id, 'estimate.customer_opened', 'customer',
      v_estimate.customer_id, 'customer', NULL,
      'Customer opened proposal version ' || v_estimate.version,
      pg_catalog.jsonb_build_object(
        'versionId', v_estimate.id,
        'jobId', v_estimate.quote_id,
        'version', v_estimate.version
      )
    );
  END IF;
  PERFORM pg_catalog.set_config('app.business_id', coalesce(v_previous_business, ''), true);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION app.record_estimate_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_estimate_open(text) TO app_user;
