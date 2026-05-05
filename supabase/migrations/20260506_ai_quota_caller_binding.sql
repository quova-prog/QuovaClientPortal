-- ============================================================
-- ORBIT: Bind check_and_log_ai_usage() identities to auth.uid()
--
-- The function defined in 20260415_ai_proxy_hardening.sql accepted
-- p_user_id and p_org_id as caller-supplied parameters and used them
-- verbatim for both the rate-limit lookup AND the INSERT into
-- ai_usage_logs. It also lacked a REVOKE / GRANT block, so it
-- inherited the Postgres default of EXECUTE granted to PUBLIC.
--
-- Combined effect: any authenticated user could hit
--   POST /rest/v1/rpc/check_and_log_ai_usage
-- with arbitrary user_id and org_id values to (a) burn another
-- user's hourly AI quota by inserting 50 rows attributed to them,
-- or (b) forge ai_usage_logs entries cross-tenant.
--
-- This migration:
--   1. Creates a new single-arg variant `check_and_log_ai_usage(p_model TEXT)`
--      that derives user_id from auth.uid() and looks up org_id from
--      the caller's profile. Caller can no longer forge identities.
--   2. Drops the legacy 3-arg variant so it cannot be reached.
--   3. Adds the missing REVOKE/GRANT hardening block to match every
--      other SECURITY DEFINER function in the codebase.
--
-- Coordinated with an Edge Function change in
-- supabase/functions/anthropic-proxy/index.ts (passing only
-- { p_model } to the RPC). Both must be deployed together.
--
-- Idempotent: CREATE OR REPLACE for the new variant; DROP IF EXISTS
-- for the legacy variant. Safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New, identity-bound variant ─────────────────────────────
CREATE OR REPLACE FUNCTION check_and_log_ai_usage(p_model TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_org_id           UUID;
  v_calls_last_hour  INT;
BEGIN
  -- Identity must come from the JWT — never from a parameter.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Org is derived from the caller's own profile.
  SELECT org_id INTO v_org_id
    FROM profiles
   WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to an organization';
  END IF;

  -- Rate limit: 50 calls per hour per authenticated user.
  SELECT COUNT(*)
    INTO v_calls_last_hour
    FROM ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= NOW() - INTERVAL '1 hour';

  IF v_calls_last_hour >= 50 THEN
    RETURN FALSE;
  END IF;

  -- Log usage with bound identities. The INSERT cannot be steered
  -- toward another user or another org from this entry point.
  INSERT INTO ai_usage_logs (user_id, org_id, model)
  VALUES (v_user_id, v_org_id, p_model);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION check_and_log_ai_usage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_and_log_ai_usage(TEXT) TO authenticated;

-- ── 2. Drop the legacy 3-arg variant ──────────────────────────
-- CREATE OR REPLACE FUNCTION cannot change a function's parameter
-- list — Postgres treats different signatures as distinct functions.
-- Without this DROP, the old buggy variant continues to coexist
-- with the new safe one, and the exploit surface remains open.
DROP FUNCTION IF EXISTS check_and_log_ai_usage(UUID, UUID, TEXT);

COMMIT;
