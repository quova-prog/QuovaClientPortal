-- ============================================================
-- QUOVA: pg_cron job — invoke send-daily-digest every hour
-- The Edge Function itself filters by user digest_time (UTC hour)
-- ============================================================
-- Prerequisites (same as alert_email_trigger):
--   1. pg_net extension enabled
--   2. pg_cron extension enabled (Supabase Dashboard > Database > Extensions)
--   3. App settings configured:
--      ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project>.supabase.co';
--      ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: run at the top of every hour
SELECT cron.schedule(
  'send-daily-digest',          -- job name
  '0 * * * *',                  -- every hour at :00
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
