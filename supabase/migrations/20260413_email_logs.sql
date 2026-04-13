-- ============================================================
-- QUOVA: Email Notification Logs
-- Tracks all sent emails for audit and debugging
-- ============================================================

CREATE TABLE email_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type  TEXT NOT NULL CHECK (email_type IN ('urgent_alert', 'daily_digest', 'weekly_digest')),
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  alert_id    UUID REFERENCES alerts(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Org admins can view email logs for audit
CREATE POLICY "email_logs_select_admin" ON email_logs
  FOR SELECT USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- No client-side INSERT — Edge Functions use service role key
-- No UPDATE or DELETE — logs are immutable

CREATE INDEX idx_email_logs_org_sent ON email_logs(org_id, sent_at DESC);
CREATE INDEX idx_email_logs_user ON email_logs(user_id, sent_at DESC);
CREATE INDEX idx_email_logs_alert ON email_logs(alert_id);
