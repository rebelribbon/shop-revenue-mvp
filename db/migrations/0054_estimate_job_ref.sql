-- After a customer signs, the server hands the approved work to the assigned
-- technician. Signing runs outside any shop session, so this maps the
-- estimate link (by its hash) to its shop and RO. Only ids are returned.
CREATE FUNCTION app.estimate_job_ref(p_hash text) RETURNS TABLE (business_id uuid, quote_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT e.business_id, e.quote_id FROM app.estimate_version e WHERE e.token_hash = p_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.estimate_job_ref(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.estimate_job_ref(text) TO app_user;
