-- ============================================================
-- ORBIT: Lock down ai_usage_logs with RLS
--
-- The table was created in 20260415_ai_proxy_hardening.sql without
-- ENABLE ROW LEVEL SECURITY and without any policies. Combined with
-- Supabase's default grants on the `public` schema (authenticated
-- role gets SELECT/INSERT/UPDATE/DELETE on every table), this
-- left ai_usage_logs wide open to PostgREST. Even after the
-- 20260506_ai_quota_caller_binding fix to check_and_log_ai_usage(),
-- an authenticated user could:
--   - SELECT every tenant's AI usage history
--   - INSERT forged attribution rows directly (bypassing the RPC)
--   - DELETE rows to dodge the 50/hour rate limit indefinitely
--   - UPDATE cost_tokens / model fields after the fact
--
-- This migration:
--   1. Enables RLS on ai_usage_logs.
--   2. Adds a SELECT policy that lets a user read their OWN rows,
--      and lets an org admin read all rows for their org. Supports
--      a future "AI usage this month" UI in Settings without
--      additional DB work.
--   3. Adds NO INSERT / UPDATE / DELETE policies. With RLS enabled
--      and no write policy, all writes from the authenticated role
--      are denied. The SECURITY DEFINER check_and_log_ai_usage()
--      function bypasses RLS (runs as function owner), so the
--      legitimate write path is unaffected.
--
-- No application code in either orbit-mvp/src or orbit-support/src
-- reads or writes this table directly today, so this lockdown
-- breaks nothing in the current deployment.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already on;
-- DROP POLICY IF EXISTS makes the policy creation re-runnable.
-- ============================================================

BEGIN;

-- 1. Turn RLS on. (Idempotent in Postgres.)
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- 2. Read access: own rows always; org admins see the whole org.
DROP POLICY IF EXISTS "ai_usage_self_or_admin_select" ON ai_usage_logs;

CREATE POLICY "ai_usage_self_or_admin_select" ON ai_usage_logs
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      org_id = current_user_org_id()
      AND current_user_role() = 'admin'
    )
  );

-- 3. NO write policies — INSERT / UPDATE / DELETE from the
--    authenticated role are now denied by the empty-policy default.
--    The SECURITY DEFINER check_and_log_ai_usage() function still
--    works because it runs with the function owner's privileges
--    (RLS is bypassed). Direct PostgREST writes from any session
--    will fail with `new row violates row-level security policy`
--    or `permission denied` style errors.

COMMIT;
