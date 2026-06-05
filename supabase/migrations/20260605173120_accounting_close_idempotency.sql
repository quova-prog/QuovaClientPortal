-- ============================================================
-- Accounting close idempotency and gap prevention
-- Re-closing an open period appends fresh rows and marks prior rows for
-- the same designation/period as superseded. Period close/lock cannot skip
-- over an earlier open period once period history exists.
-- ============================================================

CREATE OR REPLACE FUNCTION append_fair_value_measurement(
  p_designation_id        UUID,
  p_period                TEXT,
  p_fair_value_usd        NUMERIC,
  p_source                TEXT,
  p_fair_value_hierarchy  TEXT,
  p_valuation_provider    TEXT DEFAULT NULL,
  p_source_document_ref   TEXT DEFAULT NULL,
  p_spot                  NUMERIC DEFAULT NULL,
  p_forward_rate          NUMERIC DEFAULT NULL,
  p_inputs                JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append fair value measurements';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO fair_value_measurements (
    org_id, designation_id, period, fair_value_usd, source, fair_value_hierarchy,
    valuation_provider, source_document_ref, spot, forward_rate, inputs
  ) VALUES (
    v_org, p_designation_id, p_period, p_fair_value_usd, p_source, p_fair_value_hierarchy,
    p_valuation_provider, p_source_document_ref, p_spot, p_forward_rate, COALESCE(p_inputs, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  UPDATE fair_value_measurements
  SET superseded_by_id = v_id
  WHERE designation_id = p_designation_id
    AND period = p_period
    AND id <> v_id
    AND superseded_by_id IS NULL;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_effectiveness_assessment(
  p_designation_id              UUID,
  p_period                      TEXT,
  p_framework                   TEXT,
  p_method                      TEXT,
  p_verdict                     TEXT,
  p_rationale                   TEXT,
  p_actual_derivative_fv        NUMERIC DEFAULT NULL,
  p_hypothetical_derivative_fv  NUMERIC DEFAULT NULL,
  p_dollar_offset_ratio         NUMERIC DEFAULT NULL,
  p_regression_r2               NUMERIC DEFAULT NULL,
  p_regression_slope            NUMERIC DEFAULT NULL,
  p_ifrs9_economic_relationship BOOLEAN DEFAULT NULL,
  p_ifrs9_hedge_ratio           TEXT DEFAULT NULL,
  p_credit_risk_dominates       BOOLEAN DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append effectiveness assessments';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO effectiveness_assessments (
    org_id, designation_id, period, framework, method, actual_derivative_fv,
    hypothetical_derivative_fv, dollar_offset_ratio, regression_r2, regression_slope,
    ifrs9_economic_relationship, ifrs9_hedge_ratio, credit_risk_dominates,
    verdict, rationale
  ) VALUES (
    v_org, p_designation_id, p_period, p_framework, p_method, p_actual_derivative_fv,
    p_hypothetical_derivative_fv, p_dollar_offset_ratio, p_regression_r2, p_regression_slope,
    p_ifrs9_economic_relationship, p_ifrs9_hedge_ratio, p_credit_risk_dominates,
    p_verdict, p_rationale
  )
  RETURNING id INTO v_id;

  UPDATE effectiveness_assessments
  SET superseded_by_id = v_id
  WHERE designation_id = p_designation_id
    AND period = p_period
    AND id <> v_id
    AND superseded_by_id IS NULL;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_aoci_ledger_entry(
  p_designation_id     UUID,
  p_hedged_item_id     UUID,
  p_period             TEXT,
  p_event_type         TEXT,
  p_bucket             TEXT,
  p_amount_usd         NUMERIC,
  p_balance_after_usd  NUMERIC,
  p_source_event_ref   TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_item_org UUID;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append AOCI ledger entries';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  IF p_hedged_item_id IS NOT NULL THEN
    SELECT org_id INTO v_item_org
    FROM hedged_items
    WHERE id = p_hedged_item_id AND designation_id = p_designation_id;

    IF v_item_org IS NULL OR v_item_org <> v_org THEN
      RAISE EXCEPTION 'Hedged item % is not part of designation %', p_hedged_item_id, p_designation_id;
    END IF;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO aoci_ledger (
    org_id, designation_id, hedged_item_id, period, event_type, bucket,
    amount_usd, balance_after_usd, source_event_ref
  ) VALUES (
    v_org, p_designation_id, p_hedged_item_id, p_period, p_event_type,
    COALESCE(p_bucket, 'aoci_cf'), p_amount_usd, p_balance_after_usd, p_source_event_ref
  )
  RETURNING id INTO v_id;

  UPDATE aoci_ledger
  SET superseded_by_id = v_id
  WHERE designation_id = p_designation_id
    AND period = p_period
    AND id <> v_id
    AND superseded_by_id IS NULL;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_derivative_accounting_entry(
  p_designation_id                    UUID,
  p_position_id                       UUID,
  p_draw_id                           UUID,
  p_period                            TEXT,
  p_event_type                        TEXT,
  p_amount_usd                        NUMERIC,
  p_derivative_balance_after_usd      NUMERIC,
  p_fair_value_measurement_id         UUID DEFAULT NULL,
  p_source_event_ref                  TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_position_org UUID;
  v_draw_org UUID;
  v_fv_org UUID;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append derivative accounting entries';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  SELECT org_id INTO v_position_org
  FROM hedge_positions
  WHERE id = p_position_id;

  IF v_position_org IS NULL OR v_position_org <> v_org OR v_designation.position_id <> p_position_id THEN
    RAISE EXCEPTION 'Position % is not the designated instrument', p_position_id;
  END IF;

  IF p_draw_id IS NOT NULL THEN
    SELECT org_id INTO v_draw_org
    FROM hedge_position_draws
    WHERE id = p_draw_id AND position_id = p_position_id;

    IF v_draw_org IS NULL OR v_draw_org <> v_org THEN
      RAISE EXCEPTION 'Draw % is not part of position %', p_draw_id, p_position_id;
    END IF;
  END IF;

  IF p_fair_value_measurement_id IS NOT NULL THEN
    SELECT org_id INTO v_fv_org
    FROM fair_value_measurements
    WHERE id = p_fair_value_measurement_id AND designation_id = p_designation_id;

    IF v_fv_org IS NULL OR v_fv_org <> v_org THEN
      RAISE EXCEPTION 'Fair value measurement % is not part of designation %',
        p_fair_value_measurement_id, p_designation_id;
    END IF;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO derivative_accounting_ledger (
    org_id, designation_id, position_id, draw_id, period, event_type,
    amount_usd, derivative_balance_after_usd, fair_value_measurement_id,
    source_event_ref
  ) VALUES (
    v_org, p_designation_id, p_position_id, p_draw_id, p_period, p_event_type,
    p_amount_usd, p_derivative_balance_after_usd, p_fair_value_measurement_id,
    p_source_event_ref
  )
  RETURNING id INTO v_id;

  UPDATE derivative_accounting_ledger
  SET superseded_by_id = v_id
  WHERE designation_id = p_designation_id
    AND period = p_period
    AND id <> v_id
    AND superseded_by_id IS NULL;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION set_accounting_period_status(
  p_period TEXT,
  p_status TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_id UUID;
  v_current_status TEXT;
  v_previous_period TEXT := TO_CHAR((TO_DATE(p_period || '-01', 'YYYY-MM-DD') - INTERVAL '1 month'), 'YYYY-MM');
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to change accounting periods';
  END IF;
  IF p_status NOT IN ('open','closed','locked') THEN
    RAISE EXCEPTION 'Unsupported accounting period status %', p_status;
  END IF;
  IF p_period !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid accounting period %', p_period;
  END IF;
  IF p_status IN ('closed','locked')
    AND EXISTS (
      SELECT 1
      FROM accounting_periods
      WHERE org_id = v_org
        AND period < p_period
    )
    AND NOT EXISTS (
      SELECT 1
      FROM accounting_periods
      WHERE org_id = v_org
        AND period = v_previous_period
        AND status IN ('closed','locked')
    ) THEN
    RAISE EXCEPTION 'Cannot close accounting period % before previous period % is closed',
      p_period, v_previous_period;
  END IF;
  IF p_status = 'locked' THEN
    PERFORM assert_final_journal_allowed(v_org, p_period);
  END IF;

  SELECT id, status INTO v_id, v_current_status
  FROM accounting_periods
  WHERE org_id = v_org AND period = p_period;

  IF v_current_status = 'locked' THEN
    IF p_status = 'locked' THEN
      RETURN v_id;
    END IF;
    RAISE EXCEPTION 'Accounting period % is locked', p_period;
  END IF;

  INSERT INTO accounting_periods (
    org_id, period, status, closed_at, closed_by, locked_at, locked_by
  ) VALUES (
    v_org, p_period, p_status,
    CASE WHEN p_status IN ('closed','locked') THEN NOW() ELSE NULL END,
    CASE WHEN p_status IN ('closed','locked') THEN auth.uid() ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN auth.uid() ELSE NULL END
  )
  ON CONFLICT (org_id, period) DO UPDATE SET
    status = EXCLUDED.status,
    closed_at = EXCLUDED.closed_at,
    closed_by = EXCLUDED.closed_by,
    locked_at = EXCLUDED.locked_at,
    locked_by = EXCLUDED.locked_by
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
