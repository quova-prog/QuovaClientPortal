-- ============================================================
-- Pricing fields + updated plan types + set-pricing RPC
-- ============================================================

-- ── 1. Add pricing columns to organisations ───────────────
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS setup_fee   NUMERIC(10, 2) DEFAULT NULL;

-- ── 2. Update support_change_org_plan to new plan types ───
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
  IF p_new_plan NOT IN ('trial', 'demo', 'limited', 'full') THEN
    RAISE EXCEPTION 'Invalid plan: must be trial, demo, limited, or full';
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

  -- 5. Prevent downgrade from full to limited
  IF v_old_plan = 'full' AND p_new_plan = 'limited' THEN
    RAISE EXCEPTION 'Cannot downgrade from full to limited plan';
  END IF;

  -- 6. Apply the change
  UPDATE organisations
     SET plan = p_new_plan,
         updated_at = now()
   WHERE id = p_org_id;

  -- 7. Write immutable audit entry
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

-- ── 3. Create support_set_org_pricing RPC ─────────────────
CREATE OR REPLACE FUNCTION support_set_org_pricing(
  p_org_id      UUID,
  p_monthly_fee NUMERIC,
  p_setup_fee   NUMERIC,
  p_reason      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email     TEXT;
  v_actor_role      TEXT;
  v_org_name        TEXT;
  v_old_monthly_fee NUMERIC;
  v_old_setup_fee   NUMERIC;
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

  -- 2. Validate fees are non-negative if provided
  IF p_monthly_fee IS NOT NULL AND p_monthly_fee < 0 THEN
    RAISE EXCEPTION 'Monthly fee cannot be negative';
  END IF;

  IF p_setup_fee IS NOT NULL AND p_setup_fee < 0 THEN
    RAISE EXCEPTION 'Setup fee cannot be negative';
  END IF;

  -- 3. Validate reason
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 4. Get current state
  SELECT name, monthly_fee, setup_fee
    INTO v_org_name, v_old_monthly_fee, v_old_setup_fee
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  -- 5. Apply the change
  UPDATE organisations
     SET monthly_fee = p_monthly_fee,
         setup_fee   = p_setup_fee,
         updated_at  = now()
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
    'Updated pricing: monthly $' || COALESCE(p_monthly_fee::TEXT, 'null') ||
      ', setup $' || COALESCE(p_setup_fee::TEXT, 'null') || ' — ' || p_reason,
    jsonb_build_object(
      'field',          'pricing',
      'old_monthly_fee', v_old_monthly_fee,
      'old_setup_fee',   v_old_setup_fee,
      'new_monthly_fee', p_monthly_fee,
      'new_setup_fee',   p_setup_fee,
      'reason',          p_reason
    )
  );
END;
$$;

-- ── 4. Grants ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION support_set_org_pricing(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_set_org_pricing(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
