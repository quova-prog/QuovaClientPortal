-- ============================================================
-- ORBIT: Atomic signup onboarding
-- Perform tenant bootstrap in one transaction after auth signup
-- so org/profile/policy creation cannot partially succeed.
-- ============================================================

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

REVOKE ALL ON FUNCTION onboard_new_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION onboard_new_user(TEXT, TEXT) TO authenticated;
