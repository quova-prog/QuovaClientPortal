-- ============================================================
-- QUOVA: Notification Preferences (per user, DB-backed)
-- Replaces localStorage-based notification settings
-- ============================================================

-- Ensure the shared updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE notification_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email_urgent    BOOLEAN NOT NULL DEFAULT true,
  email_digest    BOOLEAN NOT NULL DEFAULT false,
  digest_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (digest_frequency IN ('daily', 'weekly')),
  digest_time     INT NOT NULL DEFAULT 8 CHECK (digest_time >= 0 AND digest_time <= 23),
  alert_types     TEXT[] NOT NULL DEFAULT ARRAY['policy_breach','maturing_position','cash_flow_due','unhedged_exposure'],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own preferences
CREATE POLICY "notif_prefs_select" ON notification_preferences
  FOR SELECT USING (user_id = auth.uid());

-- Users can insert their own row
CREATE POLICY "notif_prefs_insert" ON notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "notif_prefs_update" ON notification_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- Auto-update timestamp
CREATE TRIGGER trg_notif_prefs_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_notif_prefs_org ON notification_preferences(org_id);
CREATE INDEX idx_notif_prefs_user ON notification_preferences(user_id);
