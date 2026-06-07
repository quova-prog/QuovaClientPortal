-- Window Forward corrections
-- 1. Keep v1 pricing to fixed-rate window forwards only.
-- 2. Enforce entity-compatible draw allocations.
-- 3. Fail loudly when expired residual settlement lacks reference FX data.
-- 4. Re-key user-authored draw/close rows through current_profile_id().

ALTER TABLE public.hedge_positions
  DROP CONSTRAINT IF EXISTS window_dates_consistent;

ALTER TABLE public.hedge_positions
  ADD CONSTRAINT window_dates_consistent CHECK (
    (instrument_type = 'window_forward'
       AND window_start_date IS NOT NULL
       AND window_end_date   IS NOT NULL
       AND window_end_date >= window_start_date
       AND pricing_method = 'fixed_worst_rate')
    OR (instrument_type <> 'window_forward'
       AND window_start_date IS NULL
       AND window_end_date   IS NULL
       AND pricing_method    IS NULL)
  );

CREATE OR REPLACE FUNCTION public.record_window_draw(
  p_position_id       UUID,
  p_draw_date         DATE,
  p_draw_amount       NUMERIC,
  p_bank_confirmation TEXT DEFAULT NULL,
  p_reference_number  TEXT DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL,
  p_allocations       JSONB DEFAULT NULL,
  p_is_final          BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        UUID := public.current_user_org_id();
  v_actor_id   UUID := public.current_profile_id();
  v_pos        public.hedge_positions%ROWTYPE;
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
  v_exp        public.fx_exposures%ROWTYPE;
  v_exp_id     UUID;
  v_new_settled NUMERIC(20,2);
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record draws';
  END IF;

  SELECT * INTO v_pos FROM public.hedge_positions WHERE id = p_position_id FOR UPDATE;
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

  PERFORM public.validate_window_forward(
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
        SELECT * INTO v_exp FROM public.fx_exposures WHERE id = v_exp_id FOR UPDATE;
        IF v_exp.id IS NULL OR v_exp.org_id <> v_org THEN
          RAISE EXCEPTION 'Allocated exposure % is not in the caller organization', v_exp_id;
        END IF;
        IF v_pos.entity_id IS NOT NULL AND v_pos.entity_id IS DISTINCT FROM v_exp.entity_id THEN
          RAISE EXCEPTION 'Allocated exposure entity does not match position entity';
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

  SELECT rate INTO v_spot FROM public.fx_rates
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
  v_usd_factor := public.fx_quote_to_usd(v_quote, p_draw_date);
  v_pnl_usd := v_pnl_quote * v_usd_factor;

  SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
    FROM public.hedge_position_draws WHERE position_id = p_position_id;

  INSERT INTO public.hedge_position_draws (
    org_id, position_id, draw_seq, draw_date, draw_amount, draw_rate,
    spot_rate_at_draw, settlement_quote, realized_pnl_quote, realized_pnl_usd,
    is_final_settlement, bank_confirmation, reference_number, notes, created_by
  ) VALUES (
    v_org, p_position_id, v_seq, p_draw_date, p_draw_amount, v_draw_rate,
    v_spot, v_settlement, v_pnl_quote, v_pnl_usd,
    p_is_final, p_bank_confirmation, p_reference_number, p_notes, v_actor_id
  )
  RETURNING id INTO v_draw_id;

  IF p_allocations IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      v_alloc_amt := (v_alloc->>'allocated_amount')::NUMERIC;
      v_exp_id := NULLIF(v_alloc->>'exposure_id','')::UUID;

      INSERT INTO public.draw_exposure_allocations (
        org_id, draw_id, exposure_id, derived_source, derived_ref, allocated_amount
      ) VALUES (
        v_org, v_draw_id,
        v_exp_id,
        NULLIF(v_alloc->>'derived_source',''),
        NULLIF(v_alloc->>'derived_ref',''),
        v_alloc_amt
      );

      IF v_exp_id IS NOT NULL THEN
        SELECT * INTO v_exp FROM public.fx_exposures WHERE id = v_exp_id FOR UPDATE;
        v_new_settled := v_exp.settled_amount + v_alloc_amt;
        UPDATE public.fx_exposures
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
END;
$$;

CREATE OR REPLACE FUNCTION public.close_window_forward(
  p_position_id UUID,
  p_close_date  DATE,
  p_close_rate  NUMERIC,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        UUID := public.current_user_org_id();
  v_actor_id   UUID := public.current_profile_id();
  v_pos        public.hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_quote      TEXT;
  v_settlement NUMERIC(20,2);
  v_pnl_quote  NUMERIC(20,2);
  v_usd_factor NUMERIC(20,8);
  v_pnl_usd    NUMERIC(20,2);
  v_seq        INTEGER;
  v_draw_id    UUID;
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to close hedges';
  END IF;

  SELECT * INTO v_pos FROM public.hedge_positions WHERE id = p_position_id FOR UPDATE;
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
    UPDATE public.hedge_positions
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
  v_usd_factor := public.fx_quote_to_usd(v_quote, p_close_date);
  v_pnl_usd := v_pnl_quote * v_usd_factor;

  SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
    FROM public.hedge_position_draws WHERE position_id = p_position_id;

  INSERT INTO public.hedge_position_draws (
    org_id, position_id, draw_seq, draw_date, draw_amount, draw_rate,
    spot_rate_at_draw, settlement_quote, realized_pnl_quote, realized_pnl_usd,
    is_final_settlement, notes, created_by
  ) VALUES (
    v_org, p_position_id, v_seq, p_close_date, v_remaining, v_pos.contracted_rate,
    p_close_rate, v_settlement, v_pnl_quote, v_pnl_usd,
    TRUE, COALESCE(p_notes, 'Early close of undrawn residual'), v_actor_id
  )
  RETURNING id INTO v_draw_id;

  UPDATE public.hedge_positions
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
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_expired_windows()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos        public.hedge_positions%ROWTYPE;
  v_remaining  NUMERIC(20,2);
  v_settle_date DATE;
  v_count      INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required to settle expired windows';
  END IF;

  FOR v_pos IN
    SELECT * FROM public.hedge_positions
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
      SELECT rate INTO v_spot FROM public.fx_rates
        WHERE currency_pair = v_pos.currency_pair AND rate_date <= v_settle_date
        ORDER BY rate_date DESC LIMIT 1;
      IF v_spot IS NULL THEN
        RAISE EXCEPTION 'No spot rate for expired window forward % on or before %',
          v_pos.id, v_settle_date;
      END IF;

      v_settlement := v_remaining * v_draw_rate;
      IF v_pos.direction = 'sell' THEN
        v_pnl_quote := (v_draw_rate - v_spot) * v_remaining;
      ELSE
        v_pnl_quote := (v_spot - v_draw_rate) * v_remaining;
      END IF;
      v_usd_factor := public.fx_quote_to_usd(v_quote, v_settle_date);
      v_pnl_usd := v_pnl_quote * v_usd_factor;
      SELECT COALESCE(MAX(draw_seq), 0) + 1 INTO v_seq
        FROM public.hedge_position_draws WHERE position_id = v_pos.id;

      INSERT INTO public.hedge_position_draws (
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
END;
$$;

REVOKE ALL ON FUNCTION public.record_window_draw(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT, JSONB, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_window_forward(UUID, DATE, NUMERIC, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_expired_windows()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_window_draw(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT, JSONB, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_window_forward(UUID, DATE, NUMERIC, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expired_windows()
  TO service_role;
