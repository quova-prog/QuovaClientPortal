-- ============================================================
-- QUOVA: DB Trigger — fire urgent email on alert insert/update
-- Uses pg_net to call the send-urgent-email Edge Function
-- ============================================================
-- Prerequisites:
--   1. pg_net extension enabled: CREATE EXTENSION IF NOT EXISTS pg_net;
--   2. App settings configured:
--      ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project>.supabase.co';
--      ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_urgent_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_plan TEXT;
  v_url  TEXT;
  v_key  TEXT;
BEGIN
  -- Only fire for urgent alerts that haven't been emailed yet
  IF NEW.severity != 'urgent' OR NEW.email_sent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Check org tier — Pro + Enterprise only
  SELECT plan INTO v_plan FROM organisations WHERE id = NEW.org_id;
  IF v_plan NOT IN ('pro', 'enterprise') THEN
    RETURN NEW;
  END IF;

  -- Read app settings
  v_url := current_setting('app.settings.supabase_url', true);
  v_key := current_setting('app.settings.service_role_key', true);

  -- Guard: skip if settings not configured
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notify_urgent_alert: app.settings.supabase_url or service_role_key not configured';
    RETURN NEW;
  END IF;

  -- Async HTTP POST to Edge Function via pg_net
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-urgent-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body    := jsonb_build_object(
      'alert_id', NEW.id::text,
      'org_id',   NEW.org_id::text
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;

CREATE TRIGGER trg_alert_urgent_email
  AFTER INSERT OR UPDATE ON alerts
  FOR EACH ROW
  EXECUTE FUNCTION notify_urgent_alert();
