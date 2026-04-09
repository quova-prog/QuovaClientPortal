-- ============================================================
-- ORBIT: Replace Limited plan with Exposure/Pro/Enterprise tiers
-- Migrates organisations.plan, creates tier_definitions,
-- removes entity-limit concept, updates support RPC.
-- ============================================================

BEGIN;

-- ── 1. Create tier_definitions table ────────────────────────
CREATE TABLE IF NOT EXISTS tier_definitions (
  id                          TEXT PRIMARY KEY,
  display_name                TEXT NOT NULL,
  description                 TEXT,
  monthly_price_cents          INTEGER,
  annual_price_cents           INTEGER,

  -- Feature flags
  feature_exposure_dashboard   BOOLEAN NOT NULL DEFAULT true,
  feature_hedge_tracking       BOOLEAN NOT NULL DEFAULT false,
  feature_coverage_analysis    BOOLEAN NOT NULL DEFAULT false,
  feature_policy_compliance    BOOLEAN NOT NULL DEFAULT false,
  feature_approval_workflows   BOOLEAN NOT NULL DEFAULT false,
  feature_audit_trail          BOOLEAN NOT NULL DEFAULT false,
  feature_board_reporting      BOOLEAN NOT NULL DEFAULT false,
  feature_ai_recommendations   BOOLEAN NOT NULL DEFAULT false,
  feature_trade_execution      BOOLEAN NOT NULL DEFAULT false,
  feature_multi_bank_rfq       BOOLEAN NOT NULL DEFAULT false,
  feature_api_access           BOOLEAN NOT NULL DEFAULT false,
  feature_sso                  BOOLEAN NOT NULL DEFAULT false,
  feature_custom_integrations  BOOLEAN NOT NULL DEFAULT false,

  -- Limits
  max_users                    INTEGER,

  -- Support
  support_level                TEXT,
  support_sla_hours            INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Seed tier definitions ────────────────────────────────
INSERT INTO tier_definitions (
  id, display_name, description,
  monthly_price_cents, annual_price_cents,
  feature_exposure_dashboard, feature_hedge_tracking, feature_coverage_analysis,
  feature_policy_compliance, feature_approval_workflows, feature_audit_trail,
  feature_board_reporting, feature_ai_recommendations,
  feature_trade_execution, feature_multi_bank_rfq,
  feature_api_access, feature_sso, feature_custom_integrations,
  max_users, support_level, support_sla_hours
) VALUES
('exposure', 'Orbit Exposure',
 'Real-time FX exposure visibility across all entities and currency pairs.',
 250000, 2700000,
 true, false, false, false, false, false, false, false, false, false, false, false, false,
 5, 'email', 24),

('pro', 'Orbit Pro',
 'Full FX risk management platform with hedging, coverage analysis, and audit trail.',
 NULL, NULL,
 true, true, true, true, true, true, true, true, false, false, false, false, false,
 25, 'email_chat', 8),

('enterprise', 'Orbit Enterprise',
 'Enterprise-grade FX infrastructure with dedicated support and custom integrations.',
 NULL, NULL,
 true, true, true, true, true, true, true, true, false, false, true, true, true,
 NULL, 'dedicated', 4)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Migrate existing organisations to new tier values ────
-- limited → exposure, trial → exposure, demo → exposure, full → pro
-- (all current customers start on exposure; manually promote to pro/enterprise as needed)
UPDATE organisations SET plan = 'exposure' WHERE plan IN ('limited', 'trial', 'demo');
UPDATE organisations SET plan = 'pro'      WHERE plan = 'full';

-- ── 4. Update default plan for new organisations ────────────
ALTER TABLE organisations ALTER COLUMN plan SET DEFAULT 'exposure';

-- ── 5. Update support_change_org_plan RPC for new tiers ─────
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

  -- 2. Validate new plan value (new tiers only)
  IF p_new_plan NOT IN ('exposure', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan: must be exposure, pro, or enterprise';
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

  -- 5. Prevent downgrade from enterprise to exposure
  IF v_old_plan = 'enterprise' AND p_new_plan = 'exposure' THEN
    RAISE EXCEPTION 'Cannot downgrade from enterprise to exposure';
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

-- ── 6. Update onboard_new_user to default to 'exposure' ─────
CREATE OR REPLACE FUNCTION onboard_new_user(
  p_org_name TEXT,
  p_full_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_org_id UUID;
  v_org_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required for onboarding';
  END IF;

  IF COALESCE(BTRIM(p_org_name), '') = '' THEN
    RAISE EXCEPTION 'Organisation name is required';
  END IF;

  SELECT org_id
  INTO v_existing_org_id
  FROM profiles
  WHERE id = v_user_id;

  IF v_existing_org_id IS NOT NULL THEN
    RETURN v_existing_org_id;
  END IF;

  -- New orgs default to 'exposure' tier (column default handles this)
  INSERT INTO organisations (name)
  VALUES (BTRIM(p_org_name))
  RETURNING id INTO v_org_id;

  INSERT INTO profiles (id, org_id, full_name, role)
  VALUES (
    v_user_id,
    v_org_id,
    NULLIF(BTRIM(p_full_name), ''),
    'admin'
  );

  INSERT INTO hedge_policies (
    org_id,
    name,
    min_coverage_pct,
    max_coverage_pct,
    min_notional_threshold,
    min_tenor_days,
    base_currency
  )
  VALUES (
    v_org_id,
    'Default Policy',
    60,
    90,
    500000,
    30,
    'USD'
  );

  RETURN v_org_id;
END;
$$;

-- ── 7. RLS for tier_definitions (read-only for all authenticated) ──
ALTER TABLE tier_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tier definitions"
  ON tier_definitions FOR SELECT
  TO authenticated
  USING (true);

COMMIT;
