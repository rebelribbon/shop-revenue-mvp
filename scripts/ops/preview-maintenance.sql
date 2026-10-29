-- Hosted preview only. Run as the provider's database administrator.
-- Install pg_cron and http in extensions. Vault values are provisioned privately.
-- Do not use pg_net for this credentialed request: its provider-owned request
-- queue grants PUBLIC access and postgres cannot revoke those provider grants.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;
CREATE OR REPLACE FUNCTION ops.run_preview_maintenance() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,extensions AS $function$
DECLARE result extensions.http_response;
BEGIN
 PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','180000');
 SELECT * INTO result FROM extensions.http(ROW(
 'GET','https://shop-revenue-m4-preview-brads-projects-3548d304.vercel.app/api/cron/maintenance',
 ARRAY[
 extensions.http_header('Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='m9_preview_cron_secret')),
 extensions.http_header('x-vercel-protection-bypass',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='m9_preview_protection_bypass'))
 ],NULL,NULL)::extensions.http_request);
 IF result.status<>200 THEN RAISE EXCEPTION 'Preview maintenance HTTP status %',result.status; END IF;
 RETURN result.status;
END $function$;
REVOKE ALL ON FUNCTION ops.run_preview_maintenance() FROM PUBLIC,anon,authenticated,app_user,worker_user,admin_user;
-- Activate only after the tested preview includes /api/cron/maintenance.
SELECT cron.schedule('shop-revenue-preview-maintenance','17 * * * *','SELECT ops.run_preview_maintenance();');
-- Verify cron.job_run_details and a new successful app maintenance heartbeat.
-- Secrets stay in Vault and memory, never in a network request queue or URL.
