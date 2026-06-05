-- ============================================================
-- Window Forwards — Phase 1 Migration E
-- Server-side policy validation used by the Phase-2 booking/draw RPCs.
-- Fail-closed: any breach raises an exception. Run as SECURITY DEFINER
-- with a locked search_path so it reads policy state authoritatively.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_window_forward(
  p_org_id        UUID,
  p_currency_pair TEXT,
  p_window_start  DATE,
  p_window_end    DATE,
  p_notional      NUMERIC,
  p_position_id   UUID DEFAULT NULL   -- set when validating an additional draw
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy     hedge_policies%ROWTYPE;
  v_span_days  INTEGER;
  v_draw_count INTEGER;
BEGIN
  SELECT * INTO v_policy FROM hedge_policies
    WHERE org_id = p_org_id AND active = TRUE
    ORDER BY entity_id NULLS LAST
    LIMIT 1;

  IF v_policy IS NULL THEN
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

  -- When validating an additional draw, enforce the per-window draw cap.
  IF p_position_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_draw_count
      FROM hedge_position_draws WHERE position_id = p_position_id;
    IF v_draw_count >= v_policy.max_draws_per_window THEN
      RAISE EXCEPTION 'Max draws per window (%) reached', v_policy.max_draws_per_window;
    END IF;
  END IF;
END $$;
