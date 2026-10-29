-- Hosted Supabase preview only; not part of the vanilla Postgres migration chain.
-- Install pg_cron/pg_net through the provider first. Store the preview bearer and
-- Vercel scheduler credential in Vault as m9_preview_cron_secret and
-- m9_preview_protection_bypass. Do not paste secret values into this file.
SELECT cron.schedule('shop-revenue-preview-maintenance','17 * * * *', $maintenance$
 SELECT net.http_get(
  url := 'https://shop-revenue-m4-preview-brads-projects-3548d304.vercel.app/api/cron/maintenance',
  headers := jsonb_build_object(
   'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='m9_preview_cron_secret'),
   'x-vercel-protection-bypass',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='m9_preview_protection_bypass')
  ), timeout_milliseconds := 180000
 );
$maintenance$);
-- Verify cron.job/cron.job_run_details and net._http_response, and confirm a new
-- successful app.maintenance_run heartbeat. Do not log request headers or Vault.
