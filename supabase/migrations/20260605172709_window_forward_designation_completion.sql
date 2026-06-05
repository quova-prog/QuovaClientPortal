-- ============================================================
-- Hedge designation completion
-- Moves a preparatory/backfilled designation to accounting-qualified
-- status only after inception documentation and hedged-item evidence exist.
-- ============================================================

CREATE OR REPLACE FUNCTION complete_hedge_designation(
  p_designation_id       UUID,
  p_inception_doc        TEXT,
  p_functional_currency  TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_doc TEXT := NULLIF(BTRIM(p_inception_doc), '');
  v_config org_accounting_config%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to complete hedge designations';
  END IF;
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'Inception documentation is required';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;
  IF v_designation.accounting_status IN ('dedesignated', 'disqualified') THEN
    RAISE EXCEPTION 'Designation % cannot be completed from status %',
      p_designation_id, v_designation.accounting_status;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM hedged_items
    WHERE designation_id = p_designation_id
      AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'At least one hedged item is required before designation completion';
  END IF;

  SELECT * INTO v_config
  FROM org_accounting_config
  WHERE org_id = v_org;

  UPDATE hedge_designations
  SET accounting_status = 'designated',
      inception_doc_status = 'complete',
      inception_doc = v_doc,
      assessment_method = COALESCE(assessment_method, v_config.effectiveness_method, 'dollar_offset'),
      functional_currency = COALESCE(p_functional_currency, functional_currency, v_config.reporting_currency),
      designated_at = COALESCE(designated_at, NOW()),
      updated_at = NOW()
  WHERE id = p_designation_id AND org_id = v_org
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION complete_hedge_designation(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION complete_hedge_designation(UUID, TEXT, TEXT)
  TO authenticated;
