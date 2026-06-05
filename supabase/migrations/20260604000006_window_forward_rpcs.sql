-- ============================================================
-- Window Forwards — Phase 2: booking & draw lifecycle RPCs
-- All write paths for window forwards go through SECURITY DEFINER
-- functions that (a) check caller org + role, (b) enforce policy via
-- validate_window_forward(), and (c) compute economics server-side so
-- the client can never supply draw_rate or P&L. Direct client inserts
-- of window_forward positions are blocked at the RLS layer.
-- ============================================================

-- ── Helper: convert a quote-currency amount factor to USD ─────────────
-- Mirrors src/lib/fx.ts toUsd direct/inverse logic against fx_rates.
-- Returns the multiplier such that (amount_in_quote * factor) = USD.
-- Raises if no rate is available (fail-closed — no silent 1:1 guess).
CREATE OR REPLACE FUNCTION fx_quote_to_usd(p_quote_ccy TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate NUMERIC(20,8);
BEGIN
  IF p_quote_ccy = 'USD' THEN
    RETURN 1;
  END IF;

  -- direct: QUOTE/USD
  SELECT rate INTO v_rate FROM fx_rates
    WHERE currency_pair = p_quote_ccy || '/USD' AND rate_date <= p_date
    ORDER BY rate_date DESC LIMIT 1;
  IF v_rate IS NOT NULL THEN
    RETURN v_rate;
  END IF;

  -- inverse: USD/QUOTE
  SELECT rate INTO v_rate FROM fx_rates
    WHERE currency_pair = 'USD/' || p_quote_ccy AND rate_date <= p_date
    ORDER BY rate_date DESC LIMIT 1;
  IF v_rate IS NOT NULL AND v_rate <> 0 THEN
    RETURN 1 / v_rate;
  END IF;

  RAISE EXCEPTION 'No USD conversion rate available for % on or before %', p_quote_ccy, p_date;
END $$;

-- ── Book a window forward (the only write path for the instrument) ────
CREATE OR REPLACE FUNCTION book_window_forward(
  p_currency_pair    TEXT,
  p_direction        TEXT,
  p_notional_base    NUMERIC,
  p_window_start     DATE,
  p_window_end       DATE,
  p_contracted_rate  NUMERIC,    -- worst-rate-in-window quote (read-only in UI)
  p_trade_date       DATE,
  p_counterparty_bank TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_hedge_type       TEXT DEFAULT 'cash_flow',
  p_notes            TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   UUID := current_user_org_id();
  v_id    UUID;
  v_base  TEXT := SPLIT_PART(p_currency_pair, '/', 1);
  v_quote TEXT := SPLIT_PART(p_currency_pair, '/', 2);
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to book hedges';
  END IF;
  IF p_direction NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Direction must be buy or sell';
  END IF;

  -- Policy gate (allowlist, eligible pair, window span).
  PERFORM validate_window_forward(v_org, p_currency_pair, p_window_start, p_window_end, p_notional_base, NULL);

  INSERT INTO hedge_positions (
    org_id, created_by, instrument_type, pricing_method,
    currency_pair, base_currency, quote_currency, direction,
    notional_base, contracted_rate, trade_date, value_date,
    window_start_date, window_end_date, drawn_notional,
    counterparty_bank, reference_number, hedge_type, status, notes
  ) VALUES (
    v_org, auth.uid(), 'window_forward', 'fixed_worst_rate',
    p_currency_pair, v_base, v_quote, p_direction,
    p_notional_base, p_contracted_rate, p_trade_date, p_window_end,
    p_window_start, p_window_end, 0,
    p_counterparty_bank, p_reference_number, p_hedge_type, 'active', p_notes
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ── Record a draw against an open window forward ──────────────────────
-- Server computes draw_rate (= contracted_rate), spot, settlement, and
-- realized P&L (quote + USD). p_allocations is an optional JSON array of
-- { exposure_id?, derived_source?, derived_ref?, allocated_amount }.
CREATE OR REPLACE FUNCTION record_window_draw(
  p_position_id      UUID,
  p_draw_date        DATE,
  p_draw_amount      NUMERIC,
  p_bank_confirmation TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL,
  p_allocations      JSONB DEFAULT NULL,
  p_is_final         BOOLEAN DEFAULT FALSE
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
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record draws';
  END IF;

  -- Lock the parent position for the duration of this draw.
  SELECT * INTO v_pos FROM hedge_positions WHERE id = p_position_id FOR UPDATE;
  IF v_pos IS NULL THEN
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

  -- Policy: per-window draw cap (validate against this position's draw count).
  PERFORM validate_window_forward(
    v_org, v_pos.currency_pair, v_pos.window_start_date, v_pos.window_end_date,
    v_pos.notional_base, p_position_id);

  -- Window + business-day checks. Final settlement (forced at window end)
  -- bypasses the in-window check because it intentionally runs after expiry.
  IF NOT p_is_final THEN
    IF p_draw_date < v_pos.window_start_date OR p_draw_date > v_pos.window_end_date THEN
      RAISE EXCEPTION 'Draw date % is outside the window % .. %',
        p_draw_date, v_pos.window_start_date, v_pos.window_end_date;
    END IF;
    IF EXTRACT(DOW FROM p_draw_date) IN (0, 6) THEN
      RAISE EXCEPTION 'Draw date % falls on a weekend (no settlement)', p_draw_date;
    END IF;
  END IF;

  v_remaining := v_pos.notional_base - v_pos.drawn_notional;
  IF p_draw_amount <= 0 THEN
    RAISE EXCEPTION 'Draw amount must be positive';
  END IF;
  IF p_draw_amount > v_remaining THEN
    RAISE EXCEPTION 'Draw amount % exceeds remaining notional %', p_draw_amount, v_remaining;
  END IF;

  v_quote := v_pos.quote_currency;

  -- draw_rate authority: server sets it from the contracted worst-rate.
  v_draw_rate := v_pos.contracted_rate;

  -- spot at draw: most recent rate on or before the draw date.
  SELECT rate INTO v_spot FROM fx_rates
    WHERE currency_pair = v_pos.currency_pair AND rate_date <= p_draw_date
    ORDER BY rate_date DESC LIMIT 1;
  IF v_spot IS NULL THEN
    RAISE EXCEPTION 'No spot rate for % on or before %', v_pos.currency_pair, p_draw_date;
  END IF;

  -- settlement amount in quote currency.
  v_settlement := p_draw_amount * v_draw_rate;

  -- realized economic P&L in quote ccy: gain from locking draw_rate vs spot.
  IF v_pos.direction = 'sell' THEN
    v_pnl_quote := (v_draw_rate - v_spot) * p_draw_amount;
  ELSE
    v_pnl_quote := (v_spot - v_draw_rate) * p_draw_amount;
  END IF;

  -- convert to USD via the helper (fail-closed if no rate).
  v_usd_factor := fx_quote_to_usd(v_quote, p_draw_date);
  v_pnl_usd := v_pnl_quote * v_usd_factor;

  -- next sequence number for this position.
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
  -- (recalc trigger updates drawn_notional + auto-closes when fully drawn)

  -- Optional draw→exposure allocations.
  IF p_allocations IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      INSERT INTO draw_exposure_allocations (
        org_id, draw_id, exposure_id, derived_source, derived_ref, allocated_amount
      ) VALUES (
        v_org, v_draw_id,
        NULLIF(v_alloc->>'exposure_id','')::UUID,
        NULLIF(v_alloc->>'derived_source',''),
        NULLIF(v_alloc->>'derived_ref',''),
        (v_alloc->>'allocated_amount')::NUMERIC
      );
      -- Mark the DB exposure partly settled so coverage and exposure fall together.
      IF NULLIF(v_alloc->>'exposure_id','') IS NOT NULL THEN
        UPDATE fx_exposures
          SET settled_amount = LEAST(notional_base,
                settled_amount + (v_alloc->>'allocated_amount')::NUMERIC)
          WHERE id = (v_alloc->>'exposure_id')::UUID AND org_id = v_org;
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

-- ── Force-settle windows that expired with undrawn notional ───────────
-- Intended to run daily (Edge Function cron or pg_cron). Inserts a final
-- draw for the residual at the contracted rate. Returns count settled.
CREATE OR REPLACE FUNCTION settle_expired_windows()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos        hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_settle_date DATE;
  v_count      INTEGER := 0;
BEGIN
  FOR v_pos IN
    SELECT * FROM hedge_positions
    WHERE instrument_type = 'window_forward'
      AND status = 'active'
      AND window_end_date < CURRENT_DATE
  LOOP
    v_remaining := v_pos.notional_base - v_pos.drawn_notional;
    IF v_remaining <= 0 THEN
      CONTINUE;  -- recalc trigger should already have closed it
    END IF;
    -- Settle as of the window end date (the latest legitimate settlement).
    v_settle_date := v_pos.window_end_date;

    -- The cron runs without an auth.uid(), so we cannot call
    -- record_window_draw() (which enforces caller role). Inline the same
    -- economics for the residual instead. created_by is left NULL.
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
        CONTINUE;  -- cannot value without a spot; leave for manual handling
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

-- ── RLS: block direct client inserts of window forwards ───────────────
-- Non-window instruments keep the existing direct-insert path; window
-- forwards must go through book_window_forward() (SECURITY DEFINER,
-- bypasses RLS). update/delete policies are unchanged.
DROP POLICY IF EXISTS "hedge_positions_insert" ON hedge_positions;
CREATE POLICY "hedge_positions_insert" ON hedge_positions
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
    AND instrument_type <> 'window_forward'
  );
