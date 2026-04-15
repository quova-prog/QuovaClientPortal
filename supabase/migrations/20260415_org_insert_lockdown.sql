-- ============================================================
-- ORBIT: Organisation Creation Hardening
-- Decouples the organisations table from public RLS insertions
-- to prevent database bloat/DoS from abandoned signups.
-- ============================================================

DROP POLICY IF EXISTS "org_insert" ON organisations;

CREATE POLICY "org_insert" ON organisations
  FOR INSERT TO authenticated
  WITH CHECK (false);
