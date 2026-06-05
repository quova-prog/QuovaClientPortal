-- ============================================================
-- ORBIT: AI proxy token/cost budgets
--
-- Upgrades ai_usage_logs from request-count-only throttling to
-- budget-aware reservations. The Edge Function inserts a reserved
-- row before the Anthropic call and updates the same row with
-- provider-reported usage after the response.
--
-- Coordinated with supabase/functions/anthropic-proxy/index.ts.
-- ============================================================

BEGIN;

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS request_bytes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS actual_output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_micros BIGINT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'reserved',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_status_check,
  DROP CONSTRAINT IF EXISTS ai_usage_logs_nonnegative_usage_check;

ALTER TABLE ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_status_check
    CHECK (status IN ('reserved', 'succeeded', 'failed')),
  ADD CONSTRAINT ai_usage_logs_nonnegative_usage_check
    CHECK (
      request_bytes >= 0
      AND estimated_input_tokens >= 0
      AND reserved_output_tokens >= 0
      AND COALESCE(actual_input_tokens, 0) >= 0
      AND COALESCE(actual_output_tokens, 0) >= 0
      AND estimated_cost_micros >= 0
      AND COALESCE(actual_cost_micros, 0) >= 0
    );

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_time
  ON ai_usage_logs(org_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_status_time
  ON ai_usage_logs(user_id, status, created_at);

CREATE OR REPLACE FUNCTION check_and_log_ai_usage(
  p_model TEXT,
  p_estimated_input_tokens INTEGER,
  p_reserved_output_tokens INTEGER,
  p_request_bytes INTEGER,
  p_estimated_cost_micros BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_calls_last_hour INTEGER;
  v_log_id UUID;
  v_requested_tokens BIGINT :=
    GREATEST(COALESCE(p_estimated_input_tokens, 0), 0)
    + GREATEST(COALESCE(p_reserved_output_tokens, 0), 0);
  v_requested_cost_micros BIGINT := GREATEST(COALESCE(p_estimated_cost_micros, 0), 0);

  v_user_daily_tokens BIGINT := 0;
  v_user_monthly_tokens BIGINT := 0;
  v_org_daily_tokens BIGINT := 0;
  v_org_monthly_tokens BIGINT := 0;
  v_user_daily_cost BIGINT := 0;
  v_user_monthly_cost BIGINT := 0;
  v_org_daily_cost BIGINT := 0;
  v_org_monthly_cost BIGINT := 0;

  -- Conservative defaults until org-configurable budgets exist.
  v_user_daily_token_limit BIGINT := 500000;
  v_user_monthly_token_limit BIGINT := 5000000;
  v_org_daily_token_limit BIGINT := 2000000;
  v_org_monthly_token_limit BIGINT := 20000000;
  v_user_daily_cost_micros BIGINT := 10000000;
  v_user_monthly_cost_micros BIGINT := 100000000;
  v_org_daily_cost_micros BIGINT := 50000000;
  v_org_monthly_cost_micros BIGINT := 1000000000;

  v_day_start TIMESTAMPTZ := date_trunc('day', NOW());
  v_month_start TIMESTAMPTZ := date_trunc('month', NOW());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT org_id INTO v_org_id
    FROM profiles
   WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to an organization';
  END IF;

  IF p_model NOT IN ('claude-haiku-4-5', 'claude-sonnet-4-20250514') THEN
    RAISE EXCEPTION 'Model not allowed';
  END IF;

  IF COALESCE(p_estimated_input_tokens, -1) < 0
     OR COALESCE(p_reserved_output_tokens, -1) < 0
     OR COALESCE(p_request_bytes, -1) < 0
     OR COALESCE(p_estimated_cost_micros, -1) < 0 THEN
    RAISE EXCEPTION 'Usage estimates must be nonnegative';
  END IF;

  -- Serialize budget reservations per org so concurrent calls cannot
  -- all pass the same pre-insert budget snapshot.
  PERFORM pg_advisory_xact_lock(9042001, hashtext(v_org_id::text));

  -- Keep the existing request-count guard as a backstop against
  -- high-frequency low-token abuse.
  SELECT COUNT(*)
    INTO v_calls_last_hour
    FROM ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= NOW() - INTERVAL '1 hour'
     AND status IN ('reserved', 'succeeded');

  IF v_calls_last_hour >= 50 THEN
    RETURN NULL;
  END IF;

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_user_daily_tokens, v_user_daily_cost
    FROM ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= v_day_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_user_monthly_tokens, v_user_monthly_cost
    FROM ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= v_month_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_org_daily_tokens, v_org_daily_cost
    FROM ai_usage_logs
   WHERE org_id = v_org_id
     AND created_at >= v_day_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_org_monthly_tokens, v_org_monthly_cost
    FROM ai_usage_logs
   WHERE org_id = v_org_id
     AND created_at >= v_month_start
     AND status IN ('reserved', 'succeeded');

  IF v_user_daily_tokens + v_requested_tokens > v_user_daily_token_limit
     OR v_user_monthly_tokens + v_requested_tokens > v_user_monthly_token_limit
     OR v_org_daily_tokens + v_requested_tokens > v_org_daily_token_limit
     OR v_org_monthly_tokens + v_requested_tokens > v_org_monthly_token_limit
     OR v_user_daily_cost + v_requested_cost_micros > v_user_daily_cost_micros
     OR v_user_monthly_cost + v_requested_cost_micros > v_user_monthly_cost_micros
     OR v_org_daily_cost + v_requested_cost_micros > v_org_daily_cost_micros
     OR v_org_monthly_cost + v_requested_cost_micros > v_org_monthly_cost_micros THEN
    RETURN NULL;
  END IF;

  INSERT INTO ai_usage_logs (
    user_id,
    org_id,
    model,
    cost_tokens,
    request_bytes,
    estimated_input_tokens,
    reserved_output_tokens,
    estimated_cost_micros,
    status
  ) VALUES (
    v_user_id,
    v_org_id,
    p_model,
    LEAST(v_requested_tokens, 2147483647)::INTEGER,
    p_request_bytes,
    p_estimated_input_tokens,
    p_reserved_output_tokens,
    p_estimated_cost_micros,
    'reserved'
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION check_and_log_ai_usage(TEXT, INTEGER, INTEGER, INTEGER, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_and_log_ai_usage(TEXT, INTEGER, INTEGER, INTEGER, BIGINT) TO authenticated;

DROP FUNCTION IF EXISTS check_and_log_ai_usage(TEXT);

COMMIT;
