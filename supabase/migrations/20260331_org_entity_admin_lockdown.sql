-- ============================================================
-- ORBIT: Org + Entity Admin Lockdown
-- Restrict tenant-control mutations to admins only.
-- ============================================================

-- ── organisations ────────────────────────────────────────────
DROP POLICY IF EXISTS "org_update_delete" ON organisations;

CREATE POLICY "org_update_admin" ON organisations
  FOR UPDATE TO authenticated
  USING (
    id = current_user_org_id()
    AND current_user_role() = 'admin'
  )
  WITH CHECK (
    id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

-- ── entities ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "org admins can manage entities" ON entities;

CREATE POLICY "entities_insert_admin" ON entities
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

CREATE POLICY "entities_update_admin" ON entities
  FOR UPDATE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  )
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

CREATE POLICY "entities_delete_admin" ON entities
  FOR DELETE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );
