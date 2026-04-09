-- ============================================================
-- ORBIT: SECURITY DEFINER search_path hardening
-- Explicitly pin search_path for helper/trigger functions that
-- execute with elevated privileges.
-- ============================================================

CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs are immutable — rows may not be updated or deleted (SOC2 CC7.2). '
    'If data correction is required contact your compliance officer.';
END;
$$;
