-- ============================================================
-- ORBIT: Persistent Alerts Table
-- ============================================================

CREATE TABLE alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  alert_key     TEXT NOT NULL,          -- dedup key e.g. 'policy_breach_under', 'maturing_hedge_<uuid>'
  type          TEXT NOT NULL,          -- 'policy_breach' | 'maturing_position' | 'cash_flow_due' | 'unhedged_exposure'
  severity      TEXT NOT NULL DEFAULT 'warning',  -- 'urgent' | 'warning' | 'info'
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  href          TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read       BOOLEAN NOT NULL DEFAULT false,
  is_dismissed  BOOLEAN NOT NULL DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, alert_key)
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_select" ON alerts
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "alerts_insert" ON alerts
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "alerts_update" ON alerts
  FOR UPDATE USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_alerts_org         ON alerts(org_id, created_at DESC);
CREATE INDEX idx_alerts_org_unread  ON alerts(org_id, is_read, is_dismissed);
CREATE INDEX idx_alerts_key         ON alerts(org_id, alert_key);
