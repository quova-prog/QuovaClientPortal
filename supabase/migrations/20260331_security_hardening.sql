-- ============================================================
-- ORBIT: Security Hardening (SOC2 CC6.3 / CC7.2)
-- ============================================================
-- 1. Standardise bank_accounts RLS to use current_user_org_id() helper
--    and add role-based write restriction (viewers cannot mutate)
-- 2. Add hard immutability trigger to audit_logs so rows cannot
--    be deleted or updated even by a Supabase dashboard admin
-- ============================================================

-- ── 1. bank_accounts — drop old inline-subquery policies ──────────────────

DROP POLICY IF EXISTS "bank_accounts_select" ON bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_insert" ON bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_update" ON bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_delete" ON bank_accounts;

-- Recreate with stable helper + role enforcement

CREATE POLICY "bank_accounts_select" ON bank_accounts
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "bank_accounts_insert" ON bank_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "bank_accounts_update" ON bank_accounts
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "bank_accounts_delete" ON bank_accounts
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── 2. audit_logs — hard immutability trigger ─────────────────────────────
-- RLS already blocks deletes for application users, but this trigger makes
-- audit_logs physically immutable even for Supabase dashboard superusers
-- acting within an application connection context.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs are immutable — rows may not be updated or deleted (SOC2 CC7.2). '
    'If data correction is required contact your compliance officer.';
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_logs_immutable
    BEFORE DELETE OR UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
