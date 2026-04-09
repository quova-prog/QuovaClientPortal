-- ============================================================
-- ORBIT: Organisation + Alerts Lockdown
-- 1. Limit organisation creation to initial onboarding only.
-- 2. Make alerts write operations admin/editor-only.
-- ============================================================

-- ── organisations ────────────────────────────────────────────
DROP POLICY IF EXISTS "org_insert" ON organisations;

CREATE POLICY "org_insert" ON organisations
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
    )
  );

-- ── alerts ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "alerts_insert" ON alerts;
DROP POLICY IF EXISTS "alerts_update" ON alerts;

CREATE POLICY "alerts_insert" ON alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "alerts_update" ON alerts
  FOR UPDATE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );
