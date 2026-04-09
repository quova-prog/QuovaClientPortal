-- Add 'limited' and 'full' plan types to support_change_org_plan RPC
-- No schema change needed — organisations.plan is a plain TEXT column
-- Only the validation inside the function needs updating.

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
  v_actor_id      UUID;
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_old_plan      TEXT;
  v_org_name      TEXT;
BEGIN
  -- 1. Caller must be an active support user
  v_actor_id := auth.uid();
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
  SELECT role  INTO v_actor_role  FROM support_users WHERE id = v_actor_id AND is_active = true;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: support user not found or inactive';
  END IF;
  IF v_actor_role <> 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- 2. Validate new plan value
  IF p_new_plan NOT IN ('trial', 'starter', 'growth', 'limited', 'full') THEN
    RAISE EXCEPTION 'Invalid plan: must be trial, starter, growth, limited, or full';
  END IF;

  -- 3. Reason must be meaningful
  IF LENGTH(TRIM(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reason must be at least 10 characters';
  END IF;

  -- 4. Fetch current plan
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
     SET plan       = p_new_plan,
         updated_at = NOW()
   WHERE id = p_org_id;

  -- 6. Write immutable support audit log
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    v_actor_id, v_actor_email, v_actor_role,
    p_org_id, v_org_name,
    'data_correction', 'organisation', p_org_id,
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

REVOKE ALL ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) TO authenticated;
