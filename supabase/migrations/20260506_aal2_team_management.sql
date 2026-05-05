-- ============================================================
-- ORBIT: Require AAL2 (verified MFA) for tenant-side admin RPCs
--
-- update_member_role(), remove_member(), and delete_organisation()
-- bypass RLS via SECURITY DEFINER and previously authorized only on
-- profiles.role = 'admin'. The React UI gates these calls behind
-- a post-MFA session, but PostgREST does not — a stolen password
-- (AAL1) was sufficient to call any of them directly via REST.
--
-- This migration adds a leading guard inside each function:
--   IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN RAISE …
--
-- accept_invite() and onboard_new_user() are intentionally NOT
-- hardened — they are bootstrap paths that must work at AAL1 (a
-- brand-new user is AAL1 by definition until MFA enrollment).
--
-- The support_* family was AAL2-hardened separately in
-- 20260430_soc2_support_rpc_aal2.sql and is unchanged here.
--
-- Idempotent: re-running this migration on already-hardened
-- functions is a no-op (CREATE OR REPLACE).
-- ============================================================

BEGIN;

-- ── 1. update_member_role ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_member_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_org  UUID;
  v_target_org  UUID;
  v_admin_count INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA required for member management';
  END IF;

  IF p_new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  SELECT role, org_id INTO v_caller_role, v_caller_org
  FROM profiles WHERE id = v_caller_id;

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_target_user_id;

  IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organization';
  END IF;

  IF p_new_role != 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM profiles
    WHERE org_id = v_caller_org AND role = 'admin' AND id != p_target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin. Promote another user first.';
    END IF;
  END IF;

  UPDATE profiles
  SET role = p_new_role, updated_at = NOW()
  WHERE id = p_target_user_id;
END;
$$;

-- ── 2. remove_member ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION remove_member(p_target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_org  UUID;
  v_target_org  UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA required for member management';
  END IF;

  SELECT role, org_id INTO v_caller_role, v_caller_org
  FROM profiles WHERE id = v_caller_id;

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can remove members';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot remove yourself from the organization';
  END IF;

  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_target_user_id;

  IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organization';
  END IF;

  DELETE FROM profiles WHERE id = p_target_user_id;
END;
$$;

-- ── 3. delete_organisation ──────────────────────────────────────
-- Function NAME is retained as British (delete_organisation) because
-- the JS client calls db.rpc('delete_organisation'); renaming would
-- break the wire contract. The error MESSAGES are US spelling to
-- match the rest of the org-rebrand pass.
CREATE OR REPLACE FUNCTION delete_organisation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id UUID;
  v_role   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA required to delete an organization';
  END IF;

  SELECT org_id, role INTO v_org_id, v_role
    FROM profiles
   WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of an organization';
  END IF;

  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'Only an admin can delete the organization';
  END IF;

  -- ON DELETE CASCADE on every org_id-keyed table cleans up the rest.
  DELETE FROM organisations WHERE id = v_org_id;
END;
$$;

COMMIT;
