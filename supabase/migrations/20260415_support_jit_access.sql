-- ============================================================
-- SECURITY: JIT (Just-In-Time) Org-Scoped Support Access
--
-- Replaces standing cross-tenant read access with time-limited,
-- per-org grants. Support staff must explicitly request access
-- to a specific org (with a reason) before reading its sensitive
-- data. Grants auto-expire after 4 hours.
--
-- Low-sensitivity metadata (org list, user counts, ERP counts)
-- remains accessible via is_support_user() for the tenant list.
-- ============================================================

-- ── 1. support_access_grants table ──────────────────────────

CREATE TABLE support_access_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours'),
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;

-- Support users can read all grants (for admin visibility)
CREATE POLICY "support_access_grants_select" ON support_access_grants
  FOR SELECT USING (is_support_user());

-- Block direct writes — all mutations go through RPCs
CREATE POLICY "support_access_grants_insert_blocked" ON support_access_grants
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "support_access_grants_update_blocked" ON support_access_grants
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY "support_access_grants_delete_blocked" ON support_access_grants
  FOR DELETE TO authenticated USING (false);

-- Fast lookup index for active grants
CREATE INDEX idx_support_access_grants_lookup
  ON support_access_grants (user_id, org_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_support_access_grants_org
  ON support_access_grants (org_id, granted_at DESC);


-- ── 2. has_support_access_to() helper ───────────────────────

CREATE OR REPLACE FUNCTION has_support_access_to(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_access_grants
    WHERE user_id = auth.uid()
      AND org_id = p_org_id
      AND expires_at > NOW()
      AND revoked_at IS NULL
  )
  AND is_support_user();
$$;


-- ── 3. support_grant_org_access() RPC ───────────────────────

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
  -- 1. Verify caller is active support user
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = v_actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user required';
  END IF;

  -- 2. Validate reason
  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required for access grants';
  END IF;

  -- 3. Validate org exists
  SELECT name INTO v_org_name FROM organisations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  -- 4. Reuse existing active grant (idempotent)
  SELECT id INTO v_existing_id
    FROM support_access_grants
   WHERE user_id = v_actor_id
     AND org_id = p_org_id
     AND expires_at > NOW()
     AND revoked_at IS NULL
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- 5. Create the grant
  INSERT INTO support_access_grants (user_id, org_id, reason)
  VALUES (v_actor_id, p_org_id, p_reason)
  RETURNING id INTO v_grant_id;

  -- 6. Immutable audit log entry
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    v_actor_id, v_email, v_role,
    p_org_id, v_org_name,
    'grant_access',
    'support_access_grants',
    v_grant_id::TEXT,
    'Granted JIT access to ' || v_org_name || ' — ' || p_reason,
    jsonb_build_object(
      'reason', p_reason,
      'expires_at', (NOW() + INTERVAL '4 hours')::TEXT,
      'grant_id', v_grant_id
    )
  );

  RETURN v_grant_id;
END;
$$;

REVOKE ALL ON FUNCTION support_grant_org_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_grant_org_access(UUID, TEXT) TO authenticated;


-- ── 4. support_revoke_org_access() RPC ──────────────────────

CREATE OR REPLACE FUNCTION support_revoke_org_access(
  p_org_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID;
  v_email    TEXT;
  v_role     TEXT;
  v_org_name TEXT;
  v_count    INT;
BEGIN
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users WHERE id = v_actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user required';
  END IF;

  SELECT name INTO v_org_name FROM organisations WHERE id = p_org_id;

  UPDATE support_access_grants
     SET revoked_at = NOW()
   WHERE user_id = v_actor_id
     AND org_id = p_org_id
     AND expires_at > NOW()
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO support_audit_logs (
      actor_id, actor_email, actor_role,
      target_org_id, target_org_name,
      action, resource, resource_id,
      summary, metadata
    ) VALUES (
      v_actor_id, v_email, v_role,
      p_org_id, v_org_name,
      'revoke_access',
      'support_access_grants',
      NULL,
      'Revoked JIT access to ' || COALESCE(v_org_name, p_org_id::TEXT),
      jsonb_build_object('grants_revoked', v_count)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION support_revoke_org_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_revoke_org_access(UUID) TO authenticated;


-- ── 5. Update RLS policies: sensitive tables → has_support_access_to() ──

-- hedge_policies
DROP POLICY IF EXISTS "hedge_policies_support_select" ON hedge_policies;
CREATE POLICY "hedge_policies_support_select" ON hedge_policies
  FOR SELECT USING (has_support_access_to(org_id));

-- fx_exposures
DROP POLICY IF EXISTS "fx_exposures_support_select" ON fx_exposures;
CREATE POLICY "fx_exposures_support_select" ON fx_exposures
  FOR SELECT USING (has_support_access_to(org_id));

-- hedge_positions
DROP POLICY IF EXISTS "hedge_positions_support_select" ON hedge_positions;
CREATE POLICY "hedge_positions_support_select" ON hedge_positions
  FOR SELECT USING (has_support_access_to(org_id));

-- upload_batches
DROP POLICY IF EXISTS "upload_batches_support_select" ON upload_batches;
CREATE POLICY "upload_batches_support_select" ON upload_batches
  FOR SELECT USING (has_support_access_to(org_id));

-- alerts
DROP POLICY IF EXISTS "alerts_support_select" ON alerts;
CREATE POLICY "alerts_support_select" ON alerts
  FOR SELECT USING (has_support_access_to(org_id));

-- entities
DROP POLICY IF EXISTS "entities_support_select" ON entities;
CREATE POLICY "entities_support_select" ON entities
  FOR SELECT USING (has_support_access_to(org_id));

-- audit_logs
DROP POLICY IF EXISTS "audit_logs_support_select" ON audit_logs;
CREATE POLICY "audit_logs_support_select" ON audit_logs
  FOR SELECT USING (has_support_access_to(org_id));

-- bank_accounts
DROP POLICY IF EXISTS "bank_accounts_support_select" ON bank_accounts;
CREATE POLICY "bank_accounts_support_select" ON bank_accounts
  FOR SELECT USING (has_support_access_to(org_id));

-- budget_rates
DROP POLICY IF EXISTS "budget_rates_support_select" ON budget_rates;
CREATE POLICY "budget_rates_support_select" ON budget_rates
  FOR SELECT USING (has_support_access_to(org_id));

-- revenue_forecasts
DROP POLICY IF EXISTS "revenue_forecasts_support_select" ON revenue_forecasts;
CREATE POLICY "revenue_forecasts_support_select" ON revenue_forecasts
  FOR SELECT USING (has_support_access_to(org_id));

-- purchase_orders
DROP POLICY IF EXISTS "purchase_orders_support_select" ON purchase_orders;
CREATE POLICY "purchase_orders_support_select" ON purchase_orders
  FOR SELECT USING (has_support_access_to(org_id));

-- cash_flows
DROP POLICY IF EXISTS "cash_flows_support_select" ON cash_flows;
CREATE POLICY "cash_flows_support_select" ON cash_flows
  FOR SELECT USING (has_support_access_to(org_id));

-- loan_schedules
DROP POLICY IF EXISTS "loan_schedules_support_select" ON loan_schedules;
CREATE POLICY "loan_schedules_support_select" ON loan_schedules
  FOR SELECT USING (has_support_access_to(org_id));

-- payroll
DROP POLICY IF EXISTS "payroll_support_select" ON payroll;
CREATE POLICY "payroll_support_select" ON payroll
  FOR SELECT USING (has_support_access_to(org_id));

-- intercompany_transfers
DROP POLICY IF EXISTS "intercompany_transfers_support_select" ON intercompany_transfers;
CREATE POLICY "intercompany_transfers_support_select" ON intercompany_transfers
  FOR SELECT USING (has_support_access_to(org_id));

-- capex
DROP POLICY IF EXISTS "capex_support_select" ON capex;
CREATE POLICY "capex_support_select" ON capex
  FOR SELECT USING (has_support_access_to(org_id));

-- supplier_contracts
DROP POLICY IF EXISTS "supplier_contracts_support_select" ON supplier_contracts;
CREATE POLICY "supplier_contracts_support_select" ON supplier_contracts
  FOR SELECT USING (has_support_access_to(org_id));

-- customer_contracts
DROP POLICY IF EXISTS "customer_contracts_support_select" ON customer_contracts;
CREATE POLICY "customer_contracts_support_select" ON customer_contracts
  FOR SELECT USING (has_support_access_to(org_id));

-- NOTE: These 3 policies STAY as is_support_user() for tenant list metadata:
--   organisations_support_select  (org names, plans)
--   profiles_support_select       (user counts)
--   erp_connections_support_select (ERP counts)


-- ── 6. Add grant check to data correction RPCs ─────────────

-- 6a. support_change_user_role — add grant check after resolving org
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

  -- JIT access grant required
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

-- 6b. support_change_org_plan — add grant check
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
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- JIT access grant required
  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  IF p_new_plan NOT IN ('exposure', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan: must be exposure, pro, or enterprise';
  END IF;

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

-- 6c. support_set_org_pricing — add grant check
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
  v_actor_email     TEXT;
  v_actor_role      TEXT;
  v_org_name        TEXT;
  v_old_monthly     NUMERIC;
  v_old_setup       NUMERIC;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- JIT access grant required
  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  SELECT name, monthly_fee, setup_fee
    INTO v_org_name, v_old_monthly, v_old_setup
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
    'Updated pricing' ||
      CASE WHEN trim(p_reason) != '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object(
      'field',      'pricing',
      'old_monthly', v_old_monthly,
      'new_monthly', p_monthly_fee,
      'old_setup',   v_old_setup,
      'new_setup',   p_setup_fee,
      'reason',      p_reason
    )
  );
END;
$$;

-- 6d. support_set_payment_method — add grant check
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
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email    TEXT;
  v_actor_role     TEXT;
  v_org_name       TEXT;
  v_old_type       TEXT;
BEGIN
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- JIT access grant required
  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organisation. Request JIT access first.';
  END IF;

  IF p_payment_type NOT IN ('credit_card', 'ach', 'invoice') THEN
    RAISE EXCEPTION 'Invalid payment type: must be credit_card, ach, or invoice';
  END IF;

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
    auth.uid(),
    v_actor_email,
    v_actor_role,
    p_org_id,
    v_org_name,
    'data_correction',
    'org_payment_methods',
    p_org_id::TEXT,
    'Set payment method: ' || COALESCE(v_old_type, 'none') || ' → ' || p_payment_type ||
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


-- ── 7. Update support_write_audit_log allowed actions ───────

CREATE OR REPLACE FUNCTION support_write_audit_log(
  p_action       TEXT,
  p_resource     TEXT,
  p_resource_id  TEXT DEFAULT NULL,
  p_target_org_id UUID DEFAULT NULL,
  p_summary      TEXT DEFAULT '',
  p_metadata     JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id    UUID;
  v_email       TEXT;
  v_role        TEXT;
  v_org_name    TEXT;
  v_allowed_actions TEXT[] := ARRAY[
    'login', 'logout', 'view_tenant', 'impersonate', 'end_impersonate',
    'view_audit_log', 'update_user', 'data_correction', 'session_timeout',
    'grant_access', 'revoke_access'
  ];
BEGIN
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = v_actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user required';
  END IF;

  IF NOT (p_action = ANY(v_allowed_actions)) THEN
    RAISE EXCEPTION 'Invalid audit action: %. Allowed: %', p_action, v_allowed_actions;
  END IF;

  IF p_target_org_id IS NOT NULL THEN
    SELECT name INTO v_org_name
      FROM organisations
     WHERE id = p_target_org_id;
  END IF;

  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata, created_at
  ) VALUES (
    v_actor_id, v_email, v_role,
    p_target_org_id, v_org_name,
    p_action, p_resource, p_resource_id,
    p_summary, p_metadata, NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION support_write_audit_log(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_write_audit_log(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated;
