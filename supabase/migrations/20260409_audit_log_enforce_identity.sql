-- ============================================================
-- SECURITY FIX: Prevent audit log identity forgery
--
-- The audit_logs INSERT policy only checks org_id matches the
-- caller's org, but user_id, user_email, and created_at are
-- supplied by the client. Any org member can forge entries
-- impersonating another user within the same tenant.
--
-- Fix: BEFORE INSERT trigger overwrites user_id, user_email,
-- and created_at from server state (auth.uid() + profiles table).
-- Same pattern as support_audit_logs enforcement trigger.
-- ============================================================

-- ── Server-side field enforcement ────────────────────────
-- Overwrite user_id, user_email, and created_at from server state
-- so the client cannot forge identity or backdate entries.
CREATE OR REPLACE FUNCTION enforce_audit_log_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'audit_logs: authenticated user required';
  END IF;

  -- Look up email from auth.users (not profiles) so it works
  -- even if the profile row hasn't been created yet (e.g. during signup)
  SELECT email INTO v_email
    FROM auth.users
   WHERE id = v_uid;

  -- Overwrite client-supplied values with server truth
  NEW.user_id    := v_uid;
  NEW.user_email := COALESCE(v_email, NEW.user_email);
  NEW.created_at := NOW();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_logs_enforce_fields
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION enforce_audit_log_fields();
