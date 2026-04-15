-- ============================================================
-- ORBIT: LLM Proxy Hardening (Quotas)
-- Adds usage tracking to prevent Financial DoS via Edge Functions.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_user_time ON ai_usage_logs(user_id, created_at);

-- Limits execution to 50 calls per hour per user
CREATE OR REPLACE FUNCTION check_and_log_ai_usage(p_user_id UUID, p_org_id UUID, p_model TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_calls_last_hour INT;
BEGIN
  -- 1. Check rate limit
  SELECT COUNT(*) INTO v_calls_last_hour
  FROM ai_usage_logs
  WHERE user_id = p_user_id 
    AND created_at >= NOW() - INTERVAL '1 hour';
    
  IF v_calls_last_hour >= 50 THEN
    RETURN FALSE; -- Blocked
  END IF;

  -- 2. Log usage
  INSERT INTO ai_usage_logs (user_id, org_id, model)
  VALUES (p_user_id, p_org_id, p_model);
  
  RETURN TRUE; -- Allowed
END;
$$;
