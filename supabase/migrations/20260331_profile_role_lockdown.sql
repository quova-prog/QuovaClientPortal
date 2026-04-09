-- ============================================================
-- ORBIT: Profile Role Lockdown
-- Prevent authenticated users from escalating privileges by
-- updating profiles.role (or moving themselves across orgs).
-- ============================================================

DROP POLICY IF EXISTS "profile_update" ON profiles;

CREATE POLICY "profile_update_self" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND org_id = current_user_org_id()
    AND role = current_user_role()
  );
