-- ============================================================
-- QUOVA: pg_cron job — invoke settle-expired-windows daily
-- Force-settles window forwards whose window has ended with undrawn
-- notional, and fires T-7 / T-2 expiry alerts. The Edge Function is
-- service-role-gated and idempotent (already-closed positions are
-- skipped), so re-running is safe.
-- ============================================================
-- Prerequisites (same as the digest/health-score crons):
--   1. pg_net extension enabled
--   2. pg_cron extension enabled (Dashboard > Database > Extensions)
--   3. App settings configured:
--      ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project>.supabase.co';
--      ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: once daily at 06:00 UTC (after ECB/Frankfurter rates refresh).
-- cron.schedule upserts by job name, so re-running this migration is safe.
SELECT cron.schedule(
  'settle-expired-windows',     -- job name
  '0 6 * * *',                  -- daily at 06:00 UTC
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/settle-expired-windows',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
