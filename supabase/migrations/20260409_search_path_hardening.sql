-- ============================================================
-- SECURITY FIX: Add SET search_path to SECURITY DEFINER functions
--
-- Several SECURITY DEFINER functions are missing an explicit
-- SET search_path, which is a privilege-boundary hardening gap.
-- Without it, a malicious schema could shadow public tables
-- (e.g. support_users, auth.users, audit_logs) and intercept
-- queries running with elevated privileges.
--
-- Functions fixed:
--   is_support_user()                  — 20260403_support_portal.sql:33
--   get_support_user_role()            — 20260403_support_portal.sql:44
--   enforce_support_audit_log_fields() — 20260403_support_portal.sql:108
--   prevent_audit_log_mutation()       — 20260331_security_hardening.sql:46
-- ============================================================

-- ── is_support_user() ────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_support_user()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_users
    WHERE id = auth.uid() AND is_active = true
  );
$$;

-- ── get_support_user_role() ──────────────────────────────────
CREATE OR REPLACE FUNCTION get_support_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM support_users
  WHERE id = auth.uid() AND is_active = true;
$$;

-- ── enforce_support_audit_log_fields() ───────────────────────
CREATE OR REPLACE FUNCTION enforce_support_audit_log_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_role  TEXT;
BEGIN
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = NEW.actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'actor_id does not match an active support user';
  END IF;

  NEW.actor_email := v_email;
  NEW.actor_role  := v_role;
  NEW.created_at  := NOW();

  RETURN NEW;
END;
$$;

-- ── prevent_audit_log_mutation() ─────────────────────────────
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs are immutable — rows may not be updated or deleted (SOC2 CC7.2). '
    'If data correction is required contact your compliance officer.';
END;
$$;
