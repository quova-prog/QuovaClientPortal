-- Migration: Make "reason for change" optional on all support data correction RPCs
-- Previously required min 10 chars in frontend + non-empty in backend

-- ── 1. support_change_org_plan ──────────────────────────────
CREATE OR REPLACE FUNCTION support_change_org_plan(
  p_org_id   UUID,
  p_new_plan TEXT,
  p_reason   TEXT DEFAULT ''
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
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  IF p_new_plan NOT IN ('exposure', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan: must be exposure, pro, or enterprise';
  END IF;

  -- reason is now optional (no validation)

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

  IF v_old_plan = 'enterprise' AND p_new_plan = 'exposure' THEN
    RAISE EXCEPTION 'Cannot downgrade from enterprise to exposure';
  END IF;

  UPDATE organisations
     SET plan = p_new_plan,
         updated_at = now()
   WHERE id = p_org_id;

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
    'Changed org plan: ' || v_old_plan || ' → ' || p_new_plan ||
      CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field',     'plan',
      'old_value', v_old_plan,
      'new_value', p_new_plan,
      'reason',    p_reason
    )
  );
END;
$$;

-- ── 2. support_change_user_role ─────────────────────────────
CREATE OR REPLACE FUNCTION support_change_user_role(
  p_profile_id  UUID,
  p_new_role    TEXT,
  p_reason      TEXT DEFAULT ''
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
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  IF p_new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: must be admin, editor, or viewer';
  END IF;

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

  -- Prevent demoting the last admin of an org
  IF v_old_role = 'admin' AND p_new_role != 'admin' THEN
    IF (SELECT COUNT(*) FROM profiles WHERE org_id = v_org_id AND role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last admin of organisation %', v_org_name;
    END IF;
  END IF;

  UPDATE profiles
     SET role = p_new_role,
         updated_at = now()
   WHERE id = p_profile_id;

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
    'Changed user role: ' || v_old_role || ' → ' || p_new_role ||
      CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field',     'role',
      'old_value', v_old_role,
      'new_value', p_new_role,
      'reason',    p_reason
    )
  );
END;
$$;

-- ── 3. support_set_org_pricing ──────────────────────────────
CREATE OR REPLACE FUNCTION support_set_org_pricing(
  p_org_id      UUID,
  p_monthly_fee NUMERIC,
  p_setup_fee   NUMERIC,
  p_reason      TEXT DEFAULT ''
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
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  IF p_monthly_fee IS NOT NULL AND p_monthly_fee < 0 THEN
    RAISE EXCEPTION 'Monthly fee cannot be negative';
  END IF;

  IF p_setup_fee IS NOT NULL AND p_setup_fee < 0 THEN
    RAISE EXCEPTION 'Setup fee cannot be negative';
  END IF;

  SELECT name, monthly_fee, setup_fee
    INTO v_org_name, v_old_monthly_fee, v_old_setup_fee
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  UPDATE organisations
     SET monthly_fee = p_monthly_fee,
         setup_fee   = p_setup_fee,
         updated_at  = now()
   WHERE id = p_org_id;

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
      ', setup $' || COALESCE(p_setup_fee::TEXT, 'null') ||
      CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
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

-- ── 4. support_set_payment_method ───────────────────────────
CREATE OR REPLACE FUNCTION support_set_payment_method(
  p_org_id              UUID,
  p_payment_type        TEXT,
  p_cc_cardholder_name  TEXT DEFAULT NULL,
  p_cc_brand            TEXT DEFAULT NULL,
  p_cc_last_four        TEXT DEFAULT NULL,
  p_cc_expiry_month     SMALLINT DEFAULT NULL,
  p_cc_expiry_year      SMALLINT DEFAULT NULL,
  p_ach_account_holder  TEXT DEFAULT NULL,
  p_ach_bank_name       TEXT DEFAULT NULL,
  p_ach_account_type    TEXT DEFAULT NULL,
  p_ach_last_four       TEXT DEFAULT NULL,
  p_invoice_contact_name  TEXT DEFAULT NULL,
  p_invoice_email         TEXT DEFAULT NULL,
  p_invoice_terms         TEXT DEFAULT NULL,
  p_reason              TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email  TEXT;
  v_actor_role   TEXT;
  v_org_name     TEXT;
  v_old_type     TEXT;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  IF p_payment_type NOT IN ('credit_card', 'ach', 'invoice') THEN
    RAISE EXCEPTION 'Invalid payment type';
  END IF;

  -- reason is now optional (no validation)

  SELECT o.name, pm.payment_type
    INTO v_org_name, v_old_type
    FROM organisations o
    LEFT JOIN org_payment_methods pm ON pm.org_id = o.id
   WHERE o.id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  INSERT INTO org_payment_methods (
    org_id, payment_type,
    cc_cardholder_name, cc_brand, cc_last_four, cc_expiry_month, cc_expiry_year,
    ach_account_holder, ach_bank_name, ach_account_type, ach_last_four,
    invoice_contact_name, invoice_email, invoice_terms,
    updated_at
  ) VALUES (
    p_org_id, p_payment_type,
    p_cc_cardholder_name, p_cc_brand, p_cc_last_four, p_cc_expiry_month, p_cc_expiry_year,
    p_ach_account_holder, p_ach_bank_name, p_ach_account_type, p_ach_last_four,
    p_invoice_contact_name, p_invoice_email, p_invoice_terms,
    now()
  )
  ON CONFLICT (org_id) DO UPDATE SET
    payment_type          = EXCLUDED.payment_type,
    cc_cardholder_name    = EXCLUDED.cc_cardholder_name,
    cc_brand              = EXCLUDED.cc_brand,
    cc_last_four          = EXCLUDED.cc_last_four,
    cc_expiry_month       = EXCLUDED.cc_expiry_month,
    cc_expiry_year        = EXCLUDED.cc_expiry_year,
    ach_account_holder    = EXCLUDED.ach_account_holder,
    ach_bank_name         = EXCLUDED.ach_bank_name,
    ach_account_type      = EXCLUDED.ach_account_type,
    ach_last_four         = EXCLUDED.ach_last_four,
    invoice_contact_name  = EXCLUDED.invoice_contact_name,
    invoice_email         = EXCLUDED.invoice_email,
    invoice_terms         = EXCLUDED.invoice_terms,
    updated_at            = EXCLUDED.updated_at;

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
    'Updated payment method: ' || COALESCE(v_old_type, 'none') || ' → ' || p_payment_type ||
      CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field',     'payment_method',
      'old_type',  v_old_type,
      'new_type',  p_payment_type,
      'reason',    p_reason
    )
  );
END;
$$;

-- ── 5. Grants ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_org_plan(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION support_change_user_role(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_user_role(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION support_set_org_pricing(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_set_org_pricing(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
