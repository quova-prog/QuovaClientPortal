-- ============================================================
-- ORBIT: Audit Logs (SOC2 CC7.2 / CC7.3)
-- ============================================================

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id      UUID,                             -- auth.uid() at time of action
  user_email   TEXT,                             -- denormalised for retention after user deletion
  action       TEXT NOT NULL,                    -- 'create' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'upload'
  resource     TEXT NOT NULL,                    -- e.g. 'hedge_position', 'cash_flow', 'purchase_order'
  resource_id  TEXT,                             -- UUID/PO number of the record affected
  summary      TEXT,                             -- human-readable one-liner
  metadata     JSONB DEFAULT '{}'::jsonb,        -- { before, after, extra context }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable: no updates or deletes allowed (append-only)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- org members can read their own org's logs
CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- authenticated users can insert logs for their own org
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- NO update / delete policies → append-only

CREATE INDEX idx_audit_logs_org        ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_logs_user       ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource   ON audit_logs(org_id, resource, resource_id);
CREATE INDEX idx_audit_logs_action     ON audit_logs(org_id, action);
