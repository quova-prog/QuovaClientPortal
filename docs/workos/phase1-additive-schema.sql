-- WorkOS Phase 1 additive database changes.
-- Run this in the orbit-mvp Supabase SQL editor after Phase 0 is merged.
-- This file is intentionally non-cutover: it adds columns and new helper
-- functions without replacing existing Supabase Auth RLS policies.

BEGIN;

-- Identity bridge columns.
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS workos_org_id TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS workos_user_id TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

ALTER TABLE public.support_users
  ADD COLUMN IF NOT EXISTS workos_user_id TEXT;

-- Audit actor groundwork for future WorkOS Edge Function and webhook writes.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS external_actor_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_workos_org_id_unique
  ON public.organisations(workos_org_id)
  WHERE workos_org_id IS NOT NULL;

-- One WorkOS user may belong to multiple customer organisations, so profile
-- uniqueness is scoped by the selected org.
DROP INDEX IF EXISTS public.idx_profiles_workos_user_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_org_unique
  ON public.profiles(workos_user_id, org_id)
  WHERE workos_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_users_workos_user_id_unique
  ON public.support_users(workos_user_id)
  WHERE workos_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_workos_identity_active
  ON public.profiles(workos_user_id, org_id)
  WHERE membership_status = 'active' AND deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_support_users_workos_identity_active
  ON public.support_users(workos_user_id)
  WHERE is_active = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'profiles_membership_status_check'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_membership_status_check
      CHECK (membership_status IN ('active', 'pending', 'deactivated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'audit_logs_actor_type_check'
       AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_actor_type_check
      CHECK (actor_type IN ('user', 'system', 'workos_webhook'));
  END IF;
END;
$$;

-- Customer WorkOS helpers. Later phases can switch existing RLS wrappers to
-- these after WorkOS provisioning and client token plumbing are deployed.
CREATE OR REPLACE FUNCTION public.current_workos_profile_id()
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

CREATE OR REPLACE FUNCTION public.current_workos_org_id()
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

CREATE OR REPLACE FUNCTION public.current_workos_user_role()
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

-- Support WorkOS helper. This deliberately does not join customer
-- organisations. Configure app.workos_internal_org_id before support RLS uses
-- this helper, so support tokens remain tied to the internal WorkOS org.
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

-- Backward-compatible audit field enforcement. Browser-user inserts still
-- resolve from auth.uid(); trusted service-role functions may set
-- app.audit_actor_profile_id for the duration of the transaction; system and
-- webhook writes must provide actor_type plus external_actor_id.
CREATE OR REPLACE FUNCTION public.enforce_audit_log_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_actor_profile_id TEXT;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    v_actor_profile_id := NULLIF(current_setting('app.audit_actor_profile_id', TRUE), '');
    IF v_actor_profile_id IS NOT NULL THEN
      v_uid := v_actor_profile_id::UUID;
    END IF;
  END IF;

  IF v_uid IS NULL THEN
    IF COALESCE(NEW.actor_type, 'user') IN ('system', 'workos_webhook')
       AND NEW.external_actor_id IS NOT NULL THEN
      NEW.actor_type := COALESCE(NEW.actor_type, 'system');
      NEW.user_id := NULL;
      NEW.user_email := COALESCE(NEW.user_email, NEW.external_actor_id);
      NEW.created_at := NOW();
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'audit_logs: authenticated user required';
  END IF;

  SELECT au.email INTO v_email
    FROM auth.users au
   WHERE au.id = v_uid;

  IF v_email IS NULL THEN
    SELECT p.email INTO v_email
      FROM public.profiles p
     WHERE p.id = v_uid;
  END IF;

  -- Authenticated or trusted user-context audit rows are always user rows;
  -- caller-supplied system/webhook actor fields are only honored in the
  -- explicit no-user branch above.
  NEW.actor_type := 'user';
  NEW.external_actor_id := NULL;
  NEW.user_id := v_uid;
  NEW.user_email := COALESCE(v_email, NEW.user_email);
  NEW.created_at := NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_audit_log_as_actor(
  p_actor_profile_id UUID,
  p_org_id UUID,
  p_action TEXT,
  p_resource TEXT,
  p_resource_id TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_audit_id UUID;
BEGIN
  SELECT p.*
    INTO v_actor
    FROM public.profiles p
   WHERE p.id = p_actor_profile_id
     AND p.org_id = p_org_id
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_logs: active actor profile required';
  END IF;

  PERFORM set_config('app.audit_actor_profile_id', p_actor_profile_id::TEXT, TRUE);

  INSERT INTO public.audit_logs (
    org_id,
    action,
    resource,
    resource_id,
    summary,
    metadata,
    actor_type
  ) VALUES (
    p_org_id,
    p_action,
    p_resource,
    p_resource_id,
    p_summary,
    COALESCE(p_metadata, '{}'::JSONB),
    'user'
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log_as_actor(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log_as_actor(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

COMMIT;
