-- Redefine window-forward booking after the hedge accounting foundation exists
-- so every booked window forward has a preparatory accounting designation.

DROP FUNCTION IF EXISTS book_window_forward(
  TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION book_window_forward(
  p_currency_pair     TEXT,
  p_direction         TEXT,
  p_notional_base     NUMERIC,
  p_window_start      DATE,
  p_window_end        DATE,
  p_contracted_rate   NUMERIC,
  p_trade_date        DATE,
  p_counterparty_bank TEXT DEFAULT NULL,
  p_reference_number  TEXT DEFAULT NULL,
  p_hedge_type        TEXT DEFAULT 'cash_flow',
  p_notes             TEXT DEFAULT NULL,
  p_entity_id         UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   UUID := current_user_org_id();
  v_id    UUID;
  v_base  TEXT := SPLIT_PART(p_currency_pair, '/', 1);
  v_quote TEXT := SPLIT_PART(p_currency_pair, '/', 2);
  v_plan  TEXT;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to book hedges';
  END IF;
  SELECT plan INTO v_plan FROM organisations WHERE id = v_org;
  IF v_plan NOT IN ('pro', 'enterprise') THEN
    RAISE EXCEPTION 'Window forwards require Quova Pro or Enterprise';
  END IF;
  IF p_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM entities WHERE id = p_entity_id AND org_id = v_org AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Entity % is not active for this organization', p_entity_id;
  END IF;
  IF p_direction NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Direction must be buy or sell';
  END IF;

  PERFORM validate_window_forward(
    v_org, p_currency_pair, p_window_start, p_window_end, p_notional_base, NULL, p_entity_id
  );

  INSERT INTO hedge_positions (
    org_id, entity_id, created_by, instrument_type, pricing_method,
    currency_pair, base_currency, quote_currency, direction,
    notional_base, contracted_rate, trade_date, value_date,
    window_start_date, window_end_date, drawn_notional,
    counterparty_bank, reference_number, hedge_type, status, notes
  ) VALUES (
    v_org, p_entity_id, auth.uid(), 'window_forward', 'fixed_worst_rate',
    p_currency_pair, v_base, v_quote, p_direction,
    p_notional_base, p_contracted_rate, p_trade_date, p_window_end,
    p_window_start, p_window_end, 0,
    p_counterparty_bank, p_reference_number, p_hedge_type, 'active', p_notes
  )
  RETURNING id INTO v_id;

  PERFORM record_designation(
    v_id,
    p_hedge_type,
    'fx_spot',
    NULL,
    NULL,
    p_notes,
    CASE WHEN p_notes IS NULL THEN 'missing' ELSE 'incomplete' END,
    NULL
  );

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION book_window_forward(
  TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION book_window_forward(
  TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;

-- Existing positions predate structured accounting designations. Backfill them
-- as preparatory only; final designation still requires complete documentation.
INSERT INTO org_accounting_config (org_id)
SELECT DISTINCT hp.org_id
FROM hedge_positions hp
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO hedge_designations (
  org_id, position_id, designation_type, framework, accounting_status,
  inception_doc_status, hedged_risk, method,
  assessment_method, inception_doc, probability_status,
  functional_currency, created_by
)
SELECT hp.org_id, hp.id, hp.hedge_type, cfg.framework, 'preparatory',
       'backfilled', 'fx_spot', cfg.designation_method,
       cfg.effectiveness_method, hp.notes, 'probable',
       NULL, hp.created_by
FROM hedge_positions hp
JOIN org_accounting_config cfg ON cfg.org_id = hp.org_id
LEFT JOIN hedge_designations existing
  ON existing.position_id = hp.id
WHERE existing.id IS NULL;
