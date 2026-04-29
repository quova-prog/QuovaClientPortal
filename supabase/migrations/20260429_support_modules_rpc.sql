-- ============================================================
-- Support Data Operations: Update Organisation Modules
-- Provides SECURITY DEFINER RPCs that allow support_admin
-- users to make audited corrections to customer modules.
-- Every function atomically applies the change AND writes
-- an immutable support_audit_logs entry.
-- ============================================================

CREATE OR REPLACE FUNCTION support_change_org_modules(
  p_org_id   UUID,
  p_modules  TEXT[],
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
  v_old_modules   TEXT[];
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

  -- 2. Validate reason is non-empty
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 3. Get current state
  SELECT modules, name
    INTO v_old_modules, v_org_name
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  -- 4. Apply the change
  UPDATE organisations
     SET modules = p_modules,
         updated_at = now()
   WHERE id = p_org_id;

  -- 5. Write immutable audit entry
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
    'Changed org modules: ' || array_to_string(v_old_modules, ',') || ' → ' || array_to_string(p_modules, ',') || ' — ' || p_reason,
    jsonb_build_object(
      'field',     'modules',
      'old_value', v_old_modules,
      'new_value', p_modules,
      'reason',    p_reason
    )
  );
END;
$$;

-- Revoke direct execution; only callable via the service role or authenticated users
REVOKE ALL ON FUNCTION support_change_org_modules(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_org_modules(UUID, TEXT[], TEXT) TO authenticated;
