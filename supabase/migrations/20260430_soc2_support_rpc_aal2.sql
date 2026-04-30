-- ============================================================
-- ORBIT: SOC2 Support RPC MFA Enforcement
-- Explicitly demands AAL2 from JWTs within Support Admin RPCs
-- to prevent password-only PostgREST calls from bypassing RLS.
-- ============================================================

-- 1. support_change_user_role
CREATE OR REPLACE FUNCTION support_change_user_role(
  p_profile_id  UUID,
  p_new_role    TEXT,
  p_reason      TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2'; -- ENFORCE MFA

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
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

  IF NOT has_support_access_to(v_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  IF v_old_role = p_new_role THEN
    RAISE EXCEPTION 'New role is the same as current role';
  END IF;

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

-- 2. support_change_org_plan
CREATE OR REPLACE FUNCTION support_change_org_plan(
  p_org_id   UUID,
  p_new_plan TEXT,
  p_reason   TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
  END IF;

  IF p_new_plan NOT IN ('trial', 'starter', 'growth', 'exposure', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan';
  END IF;

  SELECT plan, name
    INTO v_old_plan, v_org_name
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  IF v_old_plan = p_new_plan THEN
    RAISE EXCEPTION 'New plan is the same as current plan';
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
    'Changed org plan: ' || COALESCE(v_old_plan, 'none') || ' → ' || p_new_plan ||
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

-- 3. support_set_org_pricing
CREATE OR REPLACE FUNCTION support_set_org_pricing(
  p_org_id      UUID,
  p_monthly_fee NUMERIC,
  p_setup_fee   NUMERIC,
  p_reason      TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_org_name      TEXT;
  v_old_monthly   NUMERIC;
  v_old_setup     NUMERIC;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
  END IF;

  SELECT name, monthly_fee, setup_fee
    INTO v_org_name, v_old_monthly, v_old_setup
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  UPDATE organisations
     SET monthly_fee = p_monthly_fee,
         setup_fee = p_setup_fee,
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
    'Updated pricing override' || CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field', 'pricing',
      'old_monthly_fee', v_old_monthly,
      'new_monthly_fee', p_monthly_fee,
      'old_setup_fee', v_old_setup,
      'new_setup_fee', p_setup_fee,
      'reason', p_reason
    )
  );
END;
$$;

-- 4. support_set_payment_method
CREATE OR REPLACE FUNCTION support_set_payment_method(
  p_org_id               UUID,
  p_payment_type         TEXT,
  p_cc_cardholder_name   TEXT DEFAULT NULL,
  p_cc_brand             TEXT DEFAULT NULL,
  p_cc_last_four         TEXT DEFAULT NULL,
  p_cc_expiry_month      INTEGER DEFAULT NULL,
  p_cc_expiry_year       INTEGER DEFAULT NULL,
  p_ach_account_holder   TEXT DEFAULT NULL,
  p_ach_bank_name        TEXT DEFAULT NULL,
  p_ach_account_type     TEXT DEFAULT NULL,
  p_ach_last_four        TEXT DEFAULT NULL,
  p_invoice_contact_name TEXT DEFAULT NULL,
  p_invoice_email        TEXT DEFAULT NULL,
  p_invoice_terms        TEXT DEFAULT NULL,
  p_reason               TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_org_name      TEXT;
  v_old_method    RECORD;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
  END IF;

  SELECT name INTO v_org_name FROM organisations WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;

  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  SELECT payment_type INTO v_old_method FROM org_payment_methods WHERE org_id = p_org_id;

  INSERT INTO org_payment_methods (
    org_id, payment_type,
    cc_cardholder_name, cc_brand, cc_last_four, cc_expiry_month, cc_expiry_year,
    ach_account_holder, ach_bank_name, ach_account_type, ach_last_four,
    invoice_contact_name, invoice_email, invoice_terms
  ) VALUES (
    p_org_id, p_payment_type,
    p_cc_cardholder_name, p_cc_brand, p_cc_last_four, p_cc_expiry_month, p_cc_expiry_year,
    p_ach_account_holder, p_ach_bank_name, p_ach_account_type, p_ach_last_four,
    p_invoice_contact_name, p_invoice_email, p_invoice_terms
  )
  ON CONFLICT (org_id) DO UPDATE SET
    payment_type = EXCLUDED.payment_type,
    cc_cardholder_name = EXCLUDED.cc_cardholder_name,
    cc_brand = EXCLUDED.cc_brand,
    cc_last_four = EXCLUDED.cc_last_four,
    cc_expiry_month = EXCLUDED.cc_expiry_month,
    cc_expiry_year = EXCLUDED.cc_expiry_year,
    ach_account_holder = EXCLUDED.ach_account_holder,
    ach_bank_name = EXCLUDED.ach_bank_name,
    ach_account_type = EXCLUDED.ach_account_type,
    ach_last_four = EXCLUDED.ach_last_four,
    invoice_contact_name = EXCLUDED.invoice_contact_name,
    invoice_email = EXCLUDED.invoice_email,
    invoice_terms = EXCLUDED.invoice_terms,
    updated_at = now();

  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    auth.uid(), v_actor_email, v_actor_role, p_org_id, v_org_name,
    'data_correction', 'org_payment_methods', p_org_id::TEXT,
    'Updated payment method to ' || p_payment_type || CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field', 'payment_method',
      'old_type', v_old_method.payment_type,
      'new_type', p_payment_type,
      'reason', p_reason
    )
  );
END;
$$;

-- 5. support_grant_org_access
CREATE OR REPLACE FUNCTION support_grant_org_access(
  p_org_id  UUID,
  p_reason  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id    UUID;
  v_email       TEXT;
  v_role        TEXT;
  v_org_name    TEXT;
  v_grant_id    UUID;
  v_existing_id UUID;
BEGIN
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = v_actor_id AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user with AAL2 required';
  END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required for access grants';
  END IF;

  SELECT name INTO v_org_name FROM organisations WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;

  SELECT id INTO v_existing_id
    FROM support_access_grants
   WHERE user_id = v_actor_id
     AND org_id = p_org_id
     AND expires_at > NOW()
     AND revoked_at IS NULL
   ORDER BY expires_at DESC
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO support_access_grants (user_id, org_id, reason)
  VALUES (v_actor_id, p_org_id, p_reason)
  RETURNING id INTO v_grant_id;

  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id, summary, metadata
  ) VALUES (
    v_actor_id, v_email, v_role, p_org_id, v_org_name,
    'grant_access', 'support_access_grants', v_grant_id::TEXT,
    'Granted JIT access to organisation — ' || p_reason,
    jsonb_build_object('reason', p_reason, 'duration', '4 hours')
  );

  RETURN v_grant_id;
END;
$$;

-- 6. support_revoke_org_access
CREATE OR REPLACE FUNCTION support_revoke_org_access(
  p_grant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id    UUID;
  v_email       TEXT;
  v_role        TEXT;
  v_grant_rec   RECORD;
  v_org_name    TEXT;
BEGIN
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = v_actor_id AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user with AAL2 required';
  END IF;

  SELECT * INTO v_grant_rec
    FROM support_access_grants
   WHERE id = p_grant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Grant not found'; END IF;

  IF v_grant_rec.user_id != v_actor_id THEN
    RAISE EXCEPTION 'Cannot revoke another user''s access grant';
  END IF;

  IF v_grant_rec.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE support_access_grants
     SET revoked_at = NOW()
   WHERE id = p_grant_id;

  SELECT name INTO v_org_name FROM organisations WHERE id = v_grant_rec.org_id;

  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id, summary, metadata
  ) VALUES (
    v_actor_id, v_email, v_role, v_grant_rec.org_id, v_org_name,
    'revoke_access', 'support_access_grants', p_grant_id::TEXT,
    'Revoked JIT access to organisation',
    '{}'::jsonb
  );
END;
$$;

-- 7. support_change_org_modules
CREATE OR REPLACE FUNCTION support_change_org_modules(
  p_org_id   UUID,
  p_modules  TEXT[],
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_old_modules   TEXT[];
  v_org_name      TEXT;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
  END IF;

  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  SELECT modules, name
    INTO v_old_modules, v_org_name
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  UPDATE organisations
     SET modules = p_modules,
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
