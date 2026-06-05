-- ============================================================
-- Hedged item capture
-- Narrow write path for forecast transaction evidence used by structured
-- hedge-accounting designations.
-- ============================================================

CREATE OR REPLACE FUNCTION record_hedged_item(
  p_designation_id             UUID,
  p_exposure_id                UUID DEFAULT NULL,
  p_derived_source             TEXT DEFAULT NULL,
  p_derived_ref                TEXT DEFAULT NULL,
  p_forecast_window_start      DATE DEFAULT NULL,
  p_forecast_window_end        DATE DEFAULT NULL,
  p_forecast_amount            NUMERIC DEFAULT NULL,
  p_affects_earnings_on        DATE DEFAULT NULL,
  p_earnings_event_source      TEXT DEFAULT NULL,
  p_lifecycle_settlement_date  DATE DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_exposure_org UUID;
  v_derived_source TEXT := NULLIF(BTRIM(p_derived_source), '');
  v_derived_ref TEXT := NULLIF(BTRIM(p_derived_ref), '');
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record hedged items';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;
  IF v_designation.accounting_status IN ('dedesignated', 'disqualified') THEN
    RAISE EXCEPTION 'Cannot add hedged items to designation % with status %',
      p_designation_id, v_designation.accounting_status;
  END IF;

  IF p_forecast_amount IS NULL OR p_forecast_amount <= 0 THEN
    RAISE EXCEPTION 'Forecast amount must be positive';
  END IF;
  IF p_forecast_window_start IS NOT NULL
    AND p_forecast_window_end IS NOT NULL
    AND p_forecast_window_end < p_forecast_window_start THEN
    RAISE EXCEPTION 'Forecast window end cannot be before start';
  END IF;

  IF (
    p_exposure_id IS NOT NULL AND (p_derived_source IS NOT NULL OR p_derived_ref IS NOT NULL)
  ) OR (
    p_exposure_id IS NULL AND (v_derived_source IS NULL OR v_derived_ref IS NULL)
  ) THEN
    RAISE EXCEPTION 'Exactly one hedged item target is required';
  END IF;

  IF p_exposure_id IS NOT NULL THEN
    SELECT org_id INTO v_exposure_org
    FROM fx_exposures
    WHERE id = p_exposure_id AND org_id = v_org;

    IF v_exposure_org IS NULL THEN
      RAISE EXCEPTION 'Exposure % not found in caller organization', p_exposure_id;
    END IF;
  END IF;

  INSERT INTO hedged_items (
    org_id, designation_id, exposure_id,
    derived_source, derived_ref,
    forecast_window_start, forecast_window_end,
    forecast_amount,
    affects_earnings_on,
    earnings_event_source,
    lifecycle_settlement_date,
    created_by
  ) VALUES (
    v_org, p_designation_id, p_exposure_id,
    v_derived_source, v_derived_ref,
    p_forecast_window_start, p_forecast_window_end,
    p_forecast_amount,
    p_affects_earnings_on,
    p_earnings_event_source,
    p_lifecycle_settlement_date,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION record_hedged_item(
  UUID, UUID, TEXT, TEXT, DATE, DATE, NUMERIC, DATE, TEXT, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_hedged_item(
  UUID, UUID, TEXT, TEXT, DATE, DATE, NUMERIC, DATE, TEXT, DATE
) TO authenticated;
