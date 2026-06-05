-- ============================================================
-- Window Forwards — hardening pass
-- Fixes post-deploy gaps:
--   * service-role-only expired-window sweep
--   * entity-aware policy lookup + Pro/Enterprise booking gate
--   * allocation validation and exposure settlement consumption
--   * controlled early close for undrawn residuals
-- ============================================================

-- Avoid overloaded RPC ambiguity after adding entity_id-aware parameters.
DROP FUNCTION IF EXISTS validate_window_forward(UUID, TEXT, DATE, DATE, NUMERIC, UUID);
DROP FUNCTION IF EXISTS book_window_forward(TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT);

-- Entity-aware policy validation. Entity-specific policy wins; otherwise
-- fall back to the org-level policy. This remains fail-closed.
CREATE OR REPLACE FUNCTION validate_window_forward(
  p_org_id        UUID,
  p_currency_pair TEXT,
  p_window_start  DATE,
  p_window_end    DATE,
  p_notional      NUMERIC,
  p_position_id   UUID DEFAULT NULL,
  p_entity_id     UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy     hedge_policies%ROWTYPE;
  v_span_days  INTEGER;
  v_draw_count INTEGER;
BEGIN
  SELECT * INTO v_policy
  FROM hedge_policies
  WHERE org_id = p_org_id
    AND active = TRUE
    AND (entity_id = p_entity_id OR entity_id IS NULL)
  ORDER BY CASE WHEN entity_id = p_entity_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_policy.id IS NULL THEN
    RAISE EXCEPTION 'No active hedge policy for org %', p_org_id;
  END IF;

  IF NOT ('window_forward' = ANY(COALESCE(v_policy.allowed_instruments, '{}'))) THEN
    RAISE EXCEPTION 'Policy does not allow window forwards';
  END IF;

  IF NOT (p_currency_pair = ANY(COALESCE(v_policy.window_forward_pairs, '{}'))) THEN
    RAISE EXCEPTION 'Currency pair % not eligible for window forwards under policy', p_currency_pair;
  END IF;

  IF p_window_end < p_window_start THEN
    RAISE EXCEPTION 'Window end precedes window start';
  END IF;

  v_span_days := (p_window_end - p_window_start);
  IF v_span_days > v_policy.max_window_days THEN
    RAISE EXCEPTION 'Window span % days exceeds policy max %', v_span_days, v_policy.max_window_days;
  END IF;

  IF p_position_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_draw_count
      FROM hedge_position_draws WHERE position_id = p_position_id;
    IF v_draw_count >= v_policy.max_draws_per_window THEN
      RAISE EXCEPTION 'Max draws per window (%) reached', v_policy.max_draws_per_window;
    END IF;
  END IF;
END $$;

-- Book a window forward. The DB enforces Pro/Enterprise access and stores
-- entity_id so downstream policy/coverage remain scoped correctly.
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

  RETURN v_id;
END $$;

-- Record a draw with validated allocations. If linked to DB exposures,
-- the settled exposure amount and status move in the same transaction.
CREATE OR REPLACE FUNCTION record_window_draw(
  p_position_id       UUID,
  p_draw_date         DATE,
  p_draw_amount       NUMERIC,
  p_bank_confirmation TEXT DEFAULT NULL,
  p_reference_number  TEXT DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL,
  p_allocations       JSONB DEFAULT NULL,
  p_is_final          BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org        UUID := current_user_org_id();
  v_pos        hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_quote      TEXT;
  v_draw_rate  NUMERIC(20,8);
  v_spot       NUMERIC(20,8);
  v_settlement NUMERIC(20,2);
  v_pnl_quote  NUMERIC(20,2);
  v_pnl_usd    NUMERIC(20,2);
  v_usd_factor NUMERIC(20,8);
  v_seq        INTEGER;
  v_draw_id    UUID;
  v_alloc      JSONB;
  v_alloc_sum  NUMERIC(20,2) := 0;
  v_alloc_amt  NUMERIC(20,2);
  v_exp        fx_exposures%ROWTYPE;
  v_exp_id     UUID;
  v_new_settled NUMERIC(20,2);
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record draws';
  END IF;

  SELECT * INTO v_pos FROM hedge_positions WHERE id = p_position_id FOR UPDATE;
  IF v_pos.id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id;
  END IF;
  IF v_pos.org_id <> v_org THEN
    RAISE EXCEPTION 'Position belongs to another organization';
  END IF;
  IF v_pos.instrument_type <> 'window_forward' THEN
    RAISE EXCEPTION 'Position is not a window forward';
  END IF;
  IF v_pos.status <> 'active' THEN
    RAISE EXCEPTION 'Window forward is not active (status %)', v_pos.status;
  END IF;

  PERFORM validate_window_forward(
    v_org, v_pos.currency_pair, v_pos.window_start_date, v_pos.window_end_date,
    v_pos.notional_base, p_position_id, v_pos.entity_id
  );

  IF p_draw_date < v_pos.window_start_date OR p_draw_date > v_pos.window_end_date THEN
    RAISE EXCEPTION 'Draw date % is outside the window % .. %',
      p_draw_date, v_pos.window_start_date, v_pos.window_end_date;
  END IF;
  IF EXTRACT(DOW FROM p_draw_date) IN (0, 6) THEN
    RAISE EXCEPTION 'Draw date % falls on a weekend (no settlement)', p_draw_date;
  END IF;

  v_remaining := v_pos.notional_base - v_pos.drawn_notional;
  IF p_draw_amount <= 0 THEN
    RAISE EXCEPTION 'Draw amount must be positive';
  END IF;
  IF p_draw_amount > v_remaining THEN
    RAISE EXCEPTION 'Draw amount % exceeds remaining notional %', p_draw_amount, v_remaining;
  END IF;

  IF p_allocations IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      v_alloc_amt := (v_alloc->>'allocated_amount')::NUMERIC;
      IF v_alloc_amt <= 0 THEN
        RAISE EXCEPTION 'Allocation amount must be positive';
      END IF;
      v_alloc_sum := v_alloc_sum + v_alloc_amt;

      v_exp_id := NULLIF(v_alloc->>'exposure_id','')::UUID;
      IF v_exp_id IS NOT NULL THEN
        SELECT * INTO v_exp FROM fx_exposures WHERE id = v_exp_id FOR UPDATE;
        IF v_exp.id IS NULL OR v_exp.org_id <> v_org THEN
          RAISE EXCEPTION 'Allocated exposure % is not in the caller organization', v_exp_id;
        END IF;
        IF v_exp.currency_pair <> v_pos.currency_pair THEN
          RAISE EXCEPTION 'Allocated exposure pair % does not match position pair %',
            v_exp.currency_pair, v_pos.currency_pair;
        END IF;
        IF (v_pos.direction = 'sell' AND v_exp.direction <> 'receivable')
           OR (v_pos.direction = 'buy' AND v_exp.direction <> 'payable') THEN
          RAISE EXCEPTION 'Allocated exposure direction % is incompatible with % hedge',
            v_exp.direction, v_pos.direction;
        END IF;
        IF v_alloc_amt > (v_exp.notional_base - v_exp.settled_amount) THEN
          RAISE EXCEPTION 'Allocation % exceeds exposure remaining %',
            v_alloc_amt, (v_exp.notional_base - v_exp.settled_amount);
        END IF;
      ELSE
        IF NULLIF(v_alloc->>'derived_source','') IS NULL
           OR NULLIF(v_alloc->>'derived_ref','') IS NULL THEN
          RAISE EXCEPTION 'Derived allocation requires derived_source and derived_ref';
        END IF;
      END IF;
    END LOOP;

    IF v_alloc_sum > p_draw_amount THEN
      RAISE EXCEPTION 'Allocation total % exceeds draw amount %', v_alloc_sum, p_draw_amount;
    END IF;
  END IF;

  v_quote := v_pos.quote_currency;
  v_draw_rate := v_pos.contracted_rate;

  SELECT rate INTO v_spot FROM fx_rates
    WHERE currency_pair = v_pos.currency_pair AND rate_date <= p_draw_date
    ORDER BY rate_date DESC LIMIT 1;
  IF v_spot IS NULL THEN
    RAISE EXCEPTION 'No spot rate for % on or before %', v_pos.currency_pair, p_draw_date;
  END IF;

  v_settlement := p_draw_amount * v_draw_rate;
  IF v_pos.direction = 'sell' THEN
    v_pnl_quote := (v_draw_rate - v_spot) * p_draw_amount;
  ELSE
    v_pnl_quote := (v_spot - v_draw_rate) * p_draw_amount;
  END IF;
  v_usd_factor := fx_quote_to_usd(v_quote, p_draw_date);
  v_pnl_usd := v_pnl_quote * v_usd_factor;

  SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
    FROM hedge_position_draws WHERE position_id = p_position_id;

  INSERT INTO hedge_position_draws (
    org_id, position_id, draw_seq, draw_date, draw_amount, draw_rate,
    spot_rate_at_draw, settlement_quote, realized_pnl_quote, realized_pnl_usd,
    is_final_settlement, bank_confirmation, reference_number, notes, created_by
  ) VALUES (
    v_org, p_position_id, v_seq, p_draw_date, p_draw_amount, v_draw_rate,
    v_spot, v_settlement, v_pnl_quote, v_pnl_usd,
    p_is_final, p_bank_confirmation, p_reference_number, p_notes, auth.uid()
  )
  RETURNING id INTO v_draw_id;

  IF p_allocations IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      v_alloc_amt := (v_alloc->>'allocated_amount')::NUMERIC;
      v_exp_id := NULLIF(v_alloc->>'exposure_id','')::UUID;

      INSERT INTO draw_exposure_allocations (
        org_id, draw_id, exposure_id, derived_source, derived_ref, allocated_amount
      ) VALUES (
        v_org, v_draw_id,
        v_exp_id,
        NULLIF(v_alloc->>'derived_source',''),
        NULLIF(v_alloc->>'derived_ref',''),
        v_alloc_amt
      );

      IF v_exp_id IS NOT NULL THEN
        SELECT * INTO v_exp FROM fx_exposures WHERE id = v_exp_id FOR UPDATE;
        v_new_settled := v_exp.settled_amount + v_alloc_amt;
        UPDATE fx_exposures
          SET settled_amount = v_new_settled,
              status = CASE
                WHEN v_new_settled >= notional_base THEN 'closed'
                ELSE 'partially_hedged'
              END,
              updated_at = NOW()
          WHERE id = v_exp_id AND org_id = v_org;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'draw_id', v_draw_id,
    'draw_seq', v_seq,
    'draw_rate', v_draw_rate,
    'spot_rate_at_draw', v_spot,
    'settlement_quote', v_settlement,
    'realized_pnl_quote', v_pnl_quote,
    'realized_pnl_usd', v_pnl_usd,
    'remaining_after', v_remaining - p_draw_amount
  );
END $$;

-- Early close settles only the undrawn residual and stores that economics
-- as a final draw. The close rate is the counterparty closeout/spot rate.
CREATE OR REPLACE FUNCTION close_window_forward(
  p_position_id UUID,
  p_close_date  DATE,
  p_close_rate  NUMERIC,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org        UUID := current_user_org_id();
  v_pos        hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_quote      TEXT;
  v_settlement NUMERIC(20,2);
  v_pnl_quote  NUMERIC(20,2);
  v_usd_factor NUMERIC(20,8);
  v_pnl_usd    NUMERIC(20,2);
  v_seq        INTEGER;
  v_draw_id    UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to close hedges';
  END IF;

  SELECT * INTO v_pos FROM hedge_positions WHERE id = p_position_id FOR UPDATE;
  IF v_pos.id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id;
  END IF;
  IF v_pos.org_id <> v_org THEN
    RAISE EXCEPTION 'Position belongs to another organization';
  END IF;
  IF v_pos.instrument_type <> 'window_forward' THEN
    RAISE EXCEPTION 'Position is not a window forward';
  END IF;
  IF v_pos.status <> 'active' THEN
    RAISE EXCEPTION 'Window forward is not active (status %)', v_pos.status;
  END IF;
  IF p_close_rate <= 0 THEN
    RAISE EXCEPTION 'Close rate must be positive';
  END IF;

  v_remaining := v_pos.notional_base - v_pos.drawn_notional;
  IF v_remaining <= 0 THEN
    UPDATE hedge_positions
      SET status = 'closed', close_date = p_close_date, close_rate = p_close_rate, updated_at = NOW()
      WHERE id = p_position_id;
    RETURN jsonb_build_object('remaining_closed', 0, 'realized_pnl_usd', 0);
  END IF;

  v_quote := v_pos.quote_currency;
  v_settlement := v_remaining * v_pos.contracted_rate;
  IF v_pos.direction = 'sell' THEN
    v_pnl_quote := (v_pos.contracted_rate - p_close_rate) * v_remaining;
  ELSE
    v_pnl_quote := (p_close_rate - v_pos.contracted_rate) * v_remaining;
  END IF;
  v_usd_factor := fx_quote_to_usd(v_quote, p_close_date);
  v_pnl_usd := v_pnl_quote * v_usd_factor;

  SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
    FROM hedge_position_draws WHERE position_id = p_position_id;

  INSERT INTO hedge_position_draws (
    org_id, position_id, draw_seq, draw_date, draw_amount, draw_rate,
    spot_rate_at_draw, settlement_quote, realized_pnl_quote, realized_pnl_usd,
    is_final_settlement, notes, created_by
  ) VALUES (
    v_org, p_position_id, v_seq, p_close_date, v_remaining, v_pos.contracted_rate,
    p_close_rate, v_settlement, v_pnl_quote, v_pnl_usd,
    TRUE, COALESCE(p_notes, 'Early close of undrawn residual'), auth.uid()
  )
  RETURNING id INTO v_draw_id;

  UPDATE hedge_positions
    SET close_date = p_close_date,
        close_rate = p_close_rate,
        updated_at = NOW()
    WHERE id = p_position_id;

  RETURN jsonb_build_object(
    'draw_id', v_draw_id,
    'draw_seq', v_seq,
    'draw_rate', v_pos.contracted_rate,
    'spot_rate_at_draw', p_close_rate,
    'settlement_quote', v_settlement,
    'realized_pnl_quote', v_pnl_quote,
    'realized_pnl_usd', v_pnl_usd,
    'remaining_after', 0
  );
END $$;

-- Service-role-only daily sweep. Direct authenticated RPC execution is
-- both revoked below and blocked here defensively.
CREATE OR REPLACE FUNCTION settle_expired_windows()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos        hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_settle_date DATE;
  v_count      INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required to settle expired windows';
  END IF;

  FOR v_pos IN
    SELECT * FROM hedge_positions
    WHERE instrument_type = 'window_forward'
      AND status = 'active'
      AND window_end_date < CURRENT_DATE
  LOOP
    v_remaining := v_pos.notional_base - v_pos.drawn_notional;
    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;
    v_settle_date := v_pos.window_end_date;

    DECLARE
      v_quote      TEXT := v_pos.quote_currency;
      v_draw_rate  NUMERIC(20,8) := v_pos.contracted_rate;
      v_spot       NUMERIC(20,8);
      v_settlement NUMERIC(20,2);
      v_pnl_quote  NUMERIC(20,2);
      v_usd_factor NUMERIC(20,8);
      v_pnl_usd    NUMERIC(20,2);
      v_seq        INTEGER;
    BEGIN
      SELECT rate INTO v_spot FROM fx_rates
        WHERE currency_pair = v_pos.currency_pair AND rate_date <= v_settle_date
        ORDER BY rate_date DESC LIMIT 1;
      IF v_spot IS NULL THEN
        CONTINUE;
      END IF;
      v_settlement := v_remaining * v_draw_rate;
      IF v_pos.direction = 'sell' THEN
        v_pnl_quote := (v_draw_rate - v_spot) * v_remaining;
      ELSE
        v_pnl_quote := (v_spot - v_draw_rate) * v_remaining;
      END IF;
      v_usd_factor := fx_quote_to_usd(v_quote, v_settle_date);
      v_pnl_usd := v_pnl_quote * v_usd_factor;
      SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
        FROM hedge_position_draws WHERE position_id = v_pos.id;

      INSERT INTO hedge_position_draws (
        org_id, position_id, draw_seq, draw_date, draw_amount, draw_rate,
        spot_rate_at_draw, settlement_quote, realized_pnl_quote, realized_pnl_usd,
        is_final_settlement, notes
      ) VALUES (
        v_pos.org_id, v_pos.id, v_seq, v_settle_date, v_remaining, v_draw_rate,
        v_spot, v_settlement, v_pnl_quote, v_pnl_usd,
        TRUE, 'Auto-settled residual at window end'
      );
      v_count := v_count + 1;
    END;
  END LOOP;

  RETURN v_count;
END $$;

-- Exposure summaries now consume settled_amount so the exposure side falls
-- with allocated draw settlements.
CREATE OR REPLACE VIEW v_exposure_summary AS
SELECT
  e.org_id,
  e.currency_pair,
  e.base_currency,
  e.quote_currency,
  SUM(CASE WHEN e.direction = 'receivable'
           THEN GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0)
           ELSE 0 END) AS total_receivable,
  SUM(CASE WHEN e.direction = 'payable'
           THEN GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0)
           ELSE 0 END) AS total_payable,
  SUM(CASE WHEN e.direction = 'receivable'
           THEN GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0)
           WHEN e.direction = 'payable'
           THEN -GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0)
           ELSE 0 END) AS net_exposure,
  SUM(COALESCE(e.notional_usd, 0) *
      CASE WHEN e.notional_base > 0
           THEN GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0) / e.notional_base
           ELSE 0 END) AS total_usd_equivalent,
  COUNT(*) AS exposure_count,
  MIN(e.settlement_date) AS earliest_settlement,
  MAX(e.settlement_date) AS latest_settlement
FROM fx_exposures e
WHERE e.status IN ('open', 'partially_hedged')
  AND GREATEST(e.notional_base - COALESCE(e.settled_amount, 0), 0) > 0
GROUP BY e.org_id, e.currency_pair, e.base_currency, e.quote_currency;

ALTER VIEW v_exposure_summary SET (security_invoker = on);
ALTER VIEW v_hedge_coverage SET (security_invoker = on);

-- RPC exposure surface.
REVOKE ALL ON FUNCTION validate_window_forward(UUID, TEXT, DATE, DATE, NUMERIC, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fx_quote_to_usd(TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_expired_windows()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_expired_windows() TO service_role;

REVOKE ALL ON FUNCTION book_window_forward(TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION book_window_forward(TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION record_window_draw(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT, JSONB, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_window_draw(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT, JSONB, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION close_window_forward(UUID, DATE, NUMERIC, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_window_forward(UUID, DATE, NUMERIC, TEXT)
  TO authenticated;
