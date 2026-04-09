-- ============================================================
-- ORBIT: Hedge Policy + Upload Batch Role Lockdown
-- Close remaining org-member write paths that should be limited
-- to admin/editor users.
-- ============================================================

-- ── hedge_policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "hedge_policies_insert" ON hedge_policies;
DROP POLICY IF EXISTS "hedge_policies_update" ON hedge_policies;

CREATE POLICY "hedge_policies_insert" ON hedge_policies
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "hedge_policies_update" ON hedge_policies
  FOR UPDATE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── upload_batches ───────────────────────────────────────────
DROP POLICY IF EXISTS "upload_batches_insert" ON upload_batches;
DROP POLICY IF EXISTS "upload_batches_update" ON upload_batches;

CREATE POLICY "upload_batches_insert" ON upload_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "upload_batches_update" ON upload_batches
  FOR UPDATE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── bank_accounts ────────────────────────────────────────────
-- Keep existing role restrictions, but add an explicit WITH CHECK so
-- rows cannot be updated across org boundaries.
DROP POLICY IF EXISTS "bank_accounts_update" ON bank_accounts;

CREATE POLICY "bank_accounts_update" ON bank_accounts
  FOR UPDATE TO authenticated
  USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );
