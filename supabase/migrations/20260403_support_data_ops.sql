-- ============================================================
-- Phase 5: Support Data Operations
-- Provides SECURITY DEFINER RPCs that allow support_admin
-- users to make audited corrections to customer data.
-- Every function atomically applies the change AND writes
-- an immutable support_audit_logs entry.
-- ============================================================

-- ── Change a customer user's role ────────────────────────
CREATE OR REPLACE FUNCTION support_change_user_role(
  p_profile_id  UUID,
  p_new_role    TEXT,
  p_reason      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_old_role      TEXT;
  v_org_id        UUID;
  v_org_name      TEXT;
BEGIN
  -- 1. Verify caller is an active support_admin
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- 2. Validate new role value
  IF p_new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: must be admin, editor, or viewer';
  END IF;

  -- 3. Validate reason is non-empty
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 4. Get current state
  SELECT p.role, p.org_id, o.name
    INTO v_old_role, v_org_id, v_org_name
    FROM profiles p
    JOIN organisations o ON o.id = p.org_id
   WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_old_role = p_new_role THEN
    RAISE EXCEPTION 'New role is the same as current role';
  END IF;

  -- 5. Apply the change
  UPDATE profiles
     SET role = p_new_role,
         updated_at = now()
   WHERE id = p_profile_id;

  -- 6. Write immutable audit entry
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    auth.uid(),
    v_actor_email,
    v_actor_role,
    v_org_id,
    v_org_name,
    'data_correction',
    'profile',
    p_profile_id::TEXT,
    'Changed user role: ' || v_old_role || ' → ' || p_new_role || ' — ' || p_reason,
    jsonb_build_object(
      'field',     'role',
      'old_value', v_old_role,
      'new_value', p_new_role,
      'reason',    p_reason
    )
  );
END;
$$;

-- ── Change an organisation's plan ────────────────────────
CREATE OR REPLACE FUNCTION support_change_org_plan(
  p_org_id   UUID,
  p_new_plan TEXT,
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_old_plan      TEXT;
  v_org_name      TEXT;
BEGIN
  -- 1. Verify caller is an active support_admin
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- 2. Validate new plan value
  IF p_new_plan NOT IN ('trial', 'starter', 'growth') THEN
    RAISE EXCEPTION 'Invalid plan: must be trial, starter, or growth';
  END IF;

  -- 3. Validate reason is non-empty
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 4. Get current state
  SELECT plan, name
    INTO v_old_plan, v_org_name
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  IF v_old_plan = p_new_plan THEN
    RAISE EXCEPTION 'New plan is the same as current plan';
  END IF;

  -- 5. Apply the change
  UPDATE organisations
     SET plan = p_new_plan,
         updated_at = now()
   WHERE id = p_org_id;

  -- 6. Write immutable audit entry
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    auth.uid(),
    v_actor_email,
    v_actor_role,
    p_org_id,
    v_org_name,
    'data_correction',
    'organisation',
    p_org_id::TEXT,
    'Changed org plan: ' || v_old_plan || ' → ' || p_new_plan || ' — ' || p_reason,
    jsonb_build_object(
      'field',     'plan',
      'old_value', v_old_plan,
      'new_value', p_new_plan,
      'reason',    p_reason
    )
  );
END;
$$;

-- Revoke direct execution; only callable via the service role or authenticated users
REVOKE ALL ON FUNCTION support_change_user_role(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_user_role(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) TO authenticated;
