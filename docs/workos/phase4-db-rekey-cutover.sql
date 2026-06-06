-- WorkOS Phase 4 database re-key cutover.
-- Run this in the orbit-mvp Supabase SQL editor only after:
--   1. Phase 1 additive schema has been applied.
--   2. WorkOS JWTs include role, user_role, sub, and selected org_id.
--   3. organisations.workos_org_id and profiles.workos_user_id are populated.
--   4. The app is ready to use WorkOS access tokens for Supabase requests.
--
-- This cutover makes public.profiles.id and public.support_users.id the local
-- app actor IDs. They are no longer required to exist in auth.users.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Detach local app actor IDs from auth.users.
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE IF EXISTS public.support_users
  DROP CONSTRAINT IF EXISTS support_users_id_fkey;
ALTER TABLE IF EXISTS public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_user_id_fkey;
ALTER TABLE IF EXISTS public.email_logs
  DROP CONSTRAINT IF EXISTS email_logs_user_id_fkey;
ALTER TABLE IF EXISTS public.support_access_grants
  DROP CONSTRAINT IF EXISTS support_access_grants_user_id_fkey;
ALTER TABLE IF EXISTS public.ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_user_id_fkey;
ALTER TABLE IF EXISTS public.invites
  DROP CONSTRAINT IF EXISTS invites_invited_by_fkey;
ALTER TABLE IF EXISTS public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_created_by_fkey;
ALTER TABLE IF EXISTS public.nudges
  DROP CONSTRAINT IF EXISTS nudges_sent_by_fkey;
ALTER TABLE IF EXISTS public.commodity_hedges
  DROP CONSTRAINT IF EXISTS commodity_hedges_created_by_fkey;

ALTER TABLE IF EXISTS public.profiles
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE IF EXISTS public.support_users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE IF EXISTS public.email_logs
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE IF EXISTS public.ai_usage_logs
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE IF EXISTS public.invites
  ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE IF EXISTS public.commodity_hedges
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE IF EXISTS public.notification_preferences
  ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE IF EXISTS public.email_logs
  ADD CONSTRAINT email_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE IF EXISTS public.support_access_grants
  ADD CONSTRAINT support_access_grants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.support_users(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE IF EXISTS public.ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE IF EXISTS public.invites
  ADD CONSTRAINT invites_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE IF EXISTS public.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE IF EXISTS public.nudges
  ADD CONSTRAINT nudges_sent_by_fkey
  FOREIGN KEY (sent_by) REFERENCES public.support_users(id) ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE IF EXISTS public.commodity_hedges
  ADD CONSTRAINT commodity_hedges_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_profiles_workos_identity_active
  ON public.profiles(workos_user_id, org_id)
  WHERE membership_status = 'active' AND deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_support_users_workos_identity_active
  ON public.support_users(workos_user_id)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 2. Canonical WorkOS-backed customer and support helpers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.id
    FROM public.profiles p
    JOIN public.organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.org_id
    FROM public.profiles p
    JOIN public.organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.role
    FROM public.profiles p
    JOIN public.organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_workos_profile_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT public.current_profile_id()
$$;

CREATE OR REPLACE FUNCTION public.current_workos_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT public.current_user_org_id()
$$;

CREATE OR REPLACE FUNCTION public.current_workos_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT public.current_user_role()
$$;

CREATE OR REPLACE FUNCTION public.current_workos_support_user_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT su.id
    FROM public.support_users su
   WHERE su.workos_user_id = auth.jwt()->>'sub'
     AND su.is_active = TRUE
     AND auth.jwt()->>'org_id' = NULLIF(current_setting('app.workos_internal_org_id', TRUE), '')
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_support_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT public.current_workos_support_user_id() IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.get_support_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT su.role
    FROM public.support_users su
   WHERE su.id = public.current_workos_support_user_id()
     AND su.is_active = TRUE
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_support_access_to(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT public.current_workos_support_user_id() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.support_access_grants sag
        WHERE sag.user_id = public.current_workos_support_user_id()
          AND sag.org_id = p_org_id
          AND sag.expires_at > NOW()
          AND sag.revoked_at IS NULL
     )
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS policy replacements for direct identity checks.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "org_isolation" ON public.profiles;
DROP POLICY IF EXISTS "profile_insert" ON public.profiles;
DROP POLICY IF EXISTS "profile_select" ON public.profiles;
DROP POLICY IF EXISTS "profile_update" ON public.profiles;
DROP POLICY IF EXISTS "profile_select_update_delete" ON public.profiles;
DROP POLICY IF EXISTS "profile_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profile_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profile_select_org" ON public.profiles;
DROP POLICY IF EXISTS "profiles_support_select" ON public.profiles;

CREATE POLICY "profile_select_self" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = public.current_profile_id());

CREATE POLICY "profile_select_org" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND membership_status = 'active'
    AND deactivated_at IS NULL
  );

CREATE POLICY "profile_update_self" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = public.current_profile_id())
  WITH CHECK (
    id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
    AND role = public.current_user_role()
    AND membership_status = 'active'
    AND deactivated_at IS NULL
  );

CREATE POLICY "profiles_support_select" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.has_support_access_to(org_id));

DROP POLICY IF EXISTS "notif_prefs_select" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_insert" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_update" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_admin_select" ON public.notification_preferences;

CREATE POLICY "notif_prefs_select" ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_profile_id());

CREATE POLICY "notif_prefs_admin_select" ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "notif_prefs_insert" ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  );

CREATE POLICY "notif_prefs_update" ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  )
  WITH CHECK (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS "email_logs_select_admin" ON public.email_logs;
CREATE POLICY "email_logs_select_admin" ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "support_users_self_select" ON public.support_users;
CREATE POLICY "support_users_self_select" ON public.support_users
  FOR SELECT
  TO authenticated
  USING (id = public.current_workos_support_user_id());

DROP POLICY IF EXISTS "support_access_grants_select" ON public.support_access_grants;
CREATE POLICY "support_access_grants_select" ON public.support_access_grants
  FOR SELECT
  TO authenticated
  USING (public.is_support_user());

DROP POLICY IF EXISTS "support_access_grants_insert_blocked" ON public.support_access_grants;
DROP POLICY IF EXISTS "support_access_grants_update_blocked" ON public.support_access_grants;
DROP POLICY IF EXISTS "support_access_grants_delete_blocked" ON public.support_access_grants;
CREATE POLICY "support_access_grants_insert_blocked" ON public.support_access_grants
  FOR INSERT TO authenticated WITH CHECK (FALSE);
CREATE POLICY "support_access_grants_update_blocked" ON public.support_access_grants
  FOR UPDATE TO authenticated USING (FALSE);
CREATE POLICY "support_access_grants_delete_blocked" ON public.support_access_grants
  FOR DELETE TO authenticated USING (FALSE);

DROP POLICY IF EXISTS "support_audit_logs_insert" ON public.support_audit_logs;
DROP POLICY IF EXISTS "support_audit_logs_select" ON public.support_audit_logs;
CREATE POLICY "support_audit_logs_insert" ON public.support_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = public.current_workos_support_user_id()
    AND public.is_support_user()
  );
CREATE POLICY "support_audit_logs_select" ON public.support_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_support_user());

DROP POLICY IF EXISTS "invites_select" ON public.invites;
DROP POLICY IF EXISTS "invites_insert" ON public.invites;
DROP POLICY IF EXISTS "invites_delete" ON public.invites;
CREATE POLICY "invites_select" ON public.invites
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_role() = 'admin'
  );
CREATE POLICY "invites_insert" ON public.invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND invited_by = public.current_profile_id()
    AND public.current_user_role() = 'admin'
  );
CREATE POLICY "invites_delete" ON public.invites
  FOR DELETE
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "onboarding_sessions_insert" ON public.onboarding_sessions;
CREATE POLICY "onboarding_sessions_insert" ON public.onboarding_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND created_by = public.current_profile_id()
  );

DROP POLICY IF EXISTS "rates_write" ON public.fx_rates;
DROP POLICY IF EXISTS "rates_update" ON public.fx_rates;
DROP POLICY IF EXISTS "rates_delete" ON public.fx_rates;
CREATE POLICY "rates_write" ON public.fx_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "rates_update" ON public.fx_rates
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "rates_delete" ON public.fx_rates
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "ai_usage_logs_select_own" ON public.ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_insert_blocked" ON public.ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_update_blocked" ON public.ai_usage_logs;
CREATE POLICY "ai_usage_logs_select_own" ON public.ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  );
CREATE POLICY "ai_usage_logs_insert_blocked" ON public.ai_usage_logs
  FOR INSERT TO authenticated WITH CHECK (FALSE);
CREATE POLICY "ai_usage_logs_update_blocked" ON public.ai_usage_logs
  FOR UPDATE TO authenticated USING (FALSE);

DROP POLICY IF EXISTS "support_users_select_nudges" ON public.nudges;
DROP POLICY IF EXISTS "support_users_insert_nudges" ON public.nudges;
CREATE POLICY "support_users_select_nudges" ON public.nudges
  FOR SELECT
  TO authenticated
  USING (public.is_support_user());
CREATE POLICY "support_users_insert_nudges" ON public.nudges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sent_by = public.current_workos_support_user_id()
    AND public.is_support_user()
  );

-- ---------------------------------------------------------------------------
-- 4. User-bound customer RPC replacements.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action       TEXT,
  p_resource     TEXT,
  p_resource_id  TEXT DEFAULT NULL,
  p_summary      TEXT DEFAULT '',
  p_metadata     JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id UUID := public.current_profile_id();
  v_email TEXT;
  v_org_id UUID := public.current_user_org_id();
  v_allowed_actions TEXT[] := ARRAY[
    'create', 'update', 'delete', 'login', 'logout', 'export', 'upload'
  ];
BEGIN
  IF v_profile_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'audit_logs: authenticated user required';
  END IF;

  SELECT email INTO v_email
    FROM public.profiles
   WHERE id = v_profile_id;

  IF NOT (p_action = ANY(v_allowed_actions)) THEN
    RAISE EXCEPTION 'Invalid audit action: %. Allowed: %', p_action, v_allowed_actions;
  END IF;

  IF trim(COALESCE(p_resource, '')) = '' THEN
    RAISE EXCEPTION 'audit_logs: resource is required';
  END IF;

  INSERT INTO public.audit_logs (
    org_id, user_id, user_email,
    action, resource, resource_id,
    summary, metadata, actor_type
  ) VALUES (
    v_org_id, v_profile_id, v_email,
    p_action, left(trim(p_resource), 100), NULLIF(left(COALESCE(p_resource_id, ''), 100), ''),
    left(COALESCE(p_summary, ''), 500), COALESCE(p_metadata, '{}'::jsonb), 'user'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_log_ai_usage(
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
  v_user_id UUID := public.current_profile_id();
  v_org_id UUID := public.current_user_org_id();
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
  IF v_user_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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

  PERFORM pg_advisory_xact_lock(9042001, hashtext(v_org_id::text));

  SELECT COUNT(*)
    INTO v_calls_last_hour
    FROM public.ai_usage_logs
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
    FROM public.ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= v_day_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_user_monthly_tokens, v_user_monthly_cost
    FROM public.ai_usage_logs
   WHERE user_id = v_user_id
     AND created_at >= v_month_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_org_daily_tokens, v_org_daily_cost
    FROM public.ai_usage_logs
   WHERE org_id = v_org_id
     AND created_at >= v_day_start
     AND status IN ('reserved', 'succeeded');

  SELECT
      COALESCE(SUM(COALESCE(actual_input_tokens + actual_output_tokens, estimated_input_tokens + reserved_output_tokens)), 0),
      COALESCE(SUM(COALESCE(actual_cost_micros, estimated_cost_micros)), 0)
    INTO v_org_monthly_tokens, v_org_monthly_cost
    FROM public.ai_usage_logs
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

  INSERT INTO public.ai_usage_logs (
    user_id, org_id, model, cost_tokens, request_bytes,
    estimated_input_tokens, reserved_output_tokens, estimated_cost_micros, status
  ) VALUES (
    v_user_id, v_org_id, p_model, LEAST(v_requested_tokens, 2147483647)::INTEGER,
    p_request_bytes, p_estimated_input_tokens, p_reserved_output_tokens,
    p_estimated_cost_micros, 'reserved'
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_member_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role();
  v_caller_org UUID := public.current_user_org_id();
  v_target_org UUID;
  v_admin_count INT;
BEGIN
  IF v_caller_id IS NULL OR v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  IF p_new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  SELECT org_id INTO v_target_org
    FROM public.profiles
   WHERE id = p_target_user_id
     AND membership_status = 'active'
     AND deactivated_at IS NULL;

  IF v_target_org IS NULL OR v_target_org <> v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organisation';
  END IF;

  IF p_new_role <> 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
      FROM public.profiles
     WHERE org_id = v_caller_org
       AND role = 'admin'
       AND id <> p_target_user_id
       AND membership_status = 'active'
       AND deactivated_at IS NULL;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin. Promote another user first.';
    END IF;
  END IF;

  UPDATE public.profiles
     SET role = p_new_role,
         updated_at = NOW()
   WHERE id = p_target_user_id
     AND org_id = v_caller_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_member(p_target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role();
  v_caller_org UUID := public.current_user_org_id();
  v_target_org UUID;
  v_target_role TEXT;
  v_admin_count INT;
BEGIN
  IF v_caller_id IS NULL OR v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can remove members';
  END IF;
  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot remove yourself from the organisation';
  END IF;

  SELECT org_id, role INTO v_target_org, v_target_role
    FROM public.profiles
   WHERE id = p_target_user_id
     AND membership_status = 'active'
     AND deactivated_at IS NULL;

  IF v_target_org IS NULL OR v_target_org <> v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organisation';
  END IF;

  IF v_target_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
      FROM public.profiles
     WHERE org_id = v_caller_org
       AND role = 'admin'
       AND id <> p_target_user_id
       AND membership_status = 'active'
       AND deactivated_at IS NULL;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last admin. Promote another user first.';
    END IF;
  END IF;

  UPDATE public.profiles
     SET membership_status = 'deactivated',
         deactivated_at = NOW(),
         updated_at = NOW()
   WHERE id = p_target_user_id
     AND org_id = v_caller_org;
END;
$$;

-- WorkOS invitation and first-login provisioning are handled outside the old
-- Supabase signup RPCs. Drop the legacy bootstrap functions at cutover.
DROP FUNCTION IF EXISTS public.accept_invite(UUID);
DROP FUNCTION IF EXISTS public.onboard_new_user(TEXT, TEXT);

-- ---------------------------------------------------------------------------
-- 5. Core hedge and accounting RPC actor re-keying.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_designation(
  p_position_id           UUID,
  p_designation_type      TEXT,
  p_hedged_risk           TEXT DEFAULT 'fx_spot',
  p_method                TEXT DEFAULT NULL,
  p_assessment_method     TEXT DEFAULT NULL,
  p_inception_doc         TEXT DEFAULT NULL,
  p_inception_doc_status  TEXT DEFAULT 'missing',
  p_functional_currency   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID := public.current_user_org_id();
  v_actor_id UUID := public.current_profile_id();
  v_config public.org_accounting_config%ROWTYPE;
  v_position public.hedge_positions%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record hedge designations';
  END IF;

  SELECT * INTO v_position
    FROM public.hedge_positions
   WHERE id = p_position_id AND org_id = v_org;

  IF v_position.id IS NULL THEN
    RAISE EXCEPTION 'Position % not found in caller organization', p_position_id;
  END IF;

  SELECT * INTO v_config FROM public.org_accounting_config WHERE org_id = v_org;
  IF v_config.id IS NULL THEN
    INSERT INTO public.org_accounting_config (org_id, updated_by)
    VALUES (v_org, v_actor_id)
    RETURNING * INTO v_config;
  END IF;

  INSERT INTO public.hedge_designations (
    org_id, position_id, designation_type, framework, accounting_status,
    inception_doc_status, hedged_risk, method, assessment_method,
    inception_doc, probability_status, functional_currency, created_by
  ) VALUES (
    v_org, p_position_id, p_designation_type, v_config.framework, 'preparatory',
    p_inception_doc_status, p_hedged_risk, COALESCE(p_method, v_config.designation_method),
    COALESCE(p_assessment_method, v_config.effectiveness_method), p_inception_doc,
    'probable', p_functional_currency, v_actor_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_window_forward(
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
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID := public.current_user_org_id();
  v_actor_id UUID := public.current_profile_id();
  v_id UUID;
  v_base TEXT := SPLIT_PART(p_currency_pair, '/', 1);
  v_quote TEXT := SPLIT_PART(p_currency_pair, '/', 2);
  v_plan TEXT;
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to book hedges';
  END IF;
  SELECT plan INTO v_plan FROM public.organisations WHERE id = v_org;
  IF v_plan NOT IN ('pro', 'enterprise') THEN
    RAISE EXCEPTION 'Window forwards require Quova Pro or Enterprise';
  END IF;
  IF p_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.entities WHERE id = p_entity_id AND org_id = v_org AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Entity % is not active for this organization', p_entity_id;
  END IF;
  IF p_direction NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Direction must be buy or sell';
  END IF;

  PERFORM public.validate_window_forward(
    v_org, p_currency_pair, p_window_start, p_window_end, p_notional_base, NULL, p_entity_id
  );

  INSERT INTO public.hedge_positions (
    org_id, entity_id, created_by, instrument_type, pricing_method,
    currency_pair, base_currency, quote_currency, direction,
    notional_base, contracted_rate, trade_date, value_date,
    window_start_date, window_end_date, drawn_notional,
    counterparty_bank, reference_number, hedge_type, status, notes
  ) VALUES (
    v_org, p_entity_id, v_actor_id, 'window_forward', 'fixed_worst_rate',
    p_currency_pair, v_base, v_quote, p_direction,
    p_notional_base, p_contracted_rate, p_trade_date, p_window_end,
    p_window_start, p_window_end, 0,
    p_counterparty_bank, p_reference_number, p_hedge_type, 'active', p_notes
  )
  RETURNING id INTO v_id;

  PERFORM public.record_designation(
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
END;
$$;

CREATE OR REPLACE FUNCTION public.record_hedged_item(
  p_designation_id             UUID,
  p_exposure_id                UUID DEFAULT NULL,
  p_derived_source             TEXT DEFAULT NULL,
  p_derived_ref                TEXT DEFAULT NULL,
  p_forecast_window_start      DATE DEFAULT NULL,
  p_forecast_window_end        DATE DEFAULT NULL,
  p_forecast_amount            NUMERIC DEFAULT NULL,
  p_affects_earnings_on        DATE DEFAULT NULL,
  p_earnings_event_source      TEXT DEFAULT NULL,
  p_lifecycle_settlement_date  DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID := public.current_user_org_id();
  v_actor_id UUID := public.current_profile_id();
  v_designation public.hedge_designations%ROWTYPE;
  v_exposure_org UUID;
  v_derived_source TEXT := NULLIF(BTRIM(p_derived_source), '');
  v_derived_ref TEXT := NULLIF(BTRIM(p_derived_ref), '');
  v_id UUID;
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record hedged items';
  END IF;

  SELECT * INTO v_designation
    FROM public.hedge_designations
   WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;
  IF v_designation.accounting_status IN ('dedesignated', 'disqualified') THEN
    RAISE EXCEPTION 'Cannot add hedged items to designation % with status %',
      p_designation_id, v_designation.accounting_status;
  END IF;

  IF p_forecast_amount IS NULL OR p_forecast_amount <= 0 THEN
    RAISE EXCEPTION 'Forecast amount must be positive';
  END IF;
  IF p_forecast_window_start IS NOT NULL
    AND p_forecast_window_end IS NOT NULL
    AND p_forecast_window_end < p_forecast_window_start THEN
    RAISE EXCEPTION 'Forecast window end cannot be before start';
  END IF;

  IF (
    p_exposure_id IS NOT NULL AND (p_derived_source IS NOT NULL OR p_derived_ref IS NOT NULL)
  ) OR (
    p_exposure_id IS NULL AND (v_derived_source IS NULL OR v_derived_ref IS NULL)
  ) THEN
    RAISE EXCEPTION 'Exactly one hedged item target is required';
  END IF;

  IF p_exposure_id IS NOT NULL THEN
    SELECT org_id INTO v_exposure_org
      FROM public.fx_exposures
     WHERE id = p_exposure_id AND org_id = v_org;

    IF v_exposure_org IS NULL THEN
      RAISE EXCEPTION 'Exposure % not found in caller organization', p_exposure_id;
    END IF;
  END IF;

  INSERT INTO public.hedged_items (
    org_id, designation_id, exposure_id,
    derived_source, derived_ref,
    forecast_window_start, forecast_window_end,
    forecast_amount,
    affects_earnings_on,
    earnings_event_source,
    lifecycle_settlement_date,
    created_by
  ) VALUES (
    v_org, p_designation_id, p_exposure_id,
    v_derived_source, v_derived_ref,
    p_forecast_window_start, p_forecast_window_end,
    p_forecast_amount,
    p_affects_earnings_on,
    p_earnings_event_source,
    p_lifecycle_settlement_date,
    v_actor_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_accounting_period_status(
  p_period TEXT,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID := public.current_user_org_id();
  v_actor_id UUID := public.current_profile_id();
  v_id UUID;
  v_current_status TEXT;
  v_previous_period TEXT := TO_CHAR((TO_DATE(p_period || '-01', 'YYYY-MM-DD') - INTERVAL '1 month'), 'YYYY-MM');
BEGIN
  IF v_org IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to change accounting periods';
  END IF;
  IF p_status NOT IN ('open','closed','locked') THEN
    RAISE EXCEPTION 'Unsupported accounting period status %', p_status;
  END IF;
  IF p_period !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid accounting period %', p_period;
  END IF;
  IF p_status IN ('closed','locked')
    AND EXISTS (
      SELECT 1
        FROM public.accounting_periods
       WHERE org_id = v_org
         AND period < p_period
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.accounting_periods
       WHERE org_id = v_org
         AND period = v_previous_period
         AND status IN ('closed','locked')
    ) THEN
    RAISE EXCEPTION 'Cannot close accounting period % before previous period % is closed',
      p_period, v_previous_period;
  END IF;
  IF p_status = 'locked' THEN
    PERFORM public.assert_final_journal_allowed(v_org, p_period);
  END IF;

  SELECT id, status INTO v_id, v_current_status
    FROM public.accounting_periods
   WHERE org_id = v_org AND period = p_period;

  IF v_current_status = 'locked' THEN
    IF p_status = 'locked' THEN
      RETURN v_id;
    END IF;
    RAISE EXCEPTION 'Accounting period % is locked', p_period;
  END IF;

  INSERT INTO public.accounting_periods (
    org_id, period, status, closed_at, closed_by, locked_at, locked_by
  ) VALUES (
    v_org, p_period, p_status,
    CASE WHEN p_status IN ('closed','locked') THEN NOW() ELSE NULL END,
    CASE WHEN p_status IN ('closed','locked') THEN v_actor_id ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN v_actor_id ELSE NULL END
  )
  ON CONFLICT (org_id, period) DO UPDATE SET
    status = EXCLUDED.status,
    closed_at = EXCLUDED.closed_at,
    closed_by = EXCLUDED.closed_by,
    locked_at = EXCLUDED.locked_at,
    locked_by = EXCLUDED.locked_by
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_and_log_ai_usage(TEXT, INTEGER, INTEGER, INTEGER, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_member_role(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_member(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_designation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_window_forward(TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_hedged_item(UUID, UUID, TEXT, TEXT, DATE, DATE, NUMERIC, DATE, TEXT, DATE)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_accounting_period_status(TEXT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_log_ai_usage(TEXT, INTEGER, INTEGER, INTEGER, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_designation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_window_forward(TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_hedged_item(UUID, UUID, TEXT, TEXT, DATE, DATE, NUMERIC, DATE, TEXT, DATE)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_accounting_period_status(TEXT, TEXT)
  TO authenticated;

COMMIT;
