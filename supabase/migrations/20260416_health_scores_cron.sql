-- ============================================================
-- QUOVA: pg_cron job — compute health scores every 6 hours
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'compute-health-scores',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/compute-health-scores',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
