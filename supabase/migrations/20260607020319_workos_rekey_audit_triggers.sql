-- WorkOS audit trigger re-key.
--
-- WorkOS access tokens use string `sub` values such as `user_...`, so audit
-- trigger code must not call auth.uid() directly. In WorkOS mode the local app
-- actor is resolved through current_profile_id(), which binds the WorkOS sub
-- and selected org_id to an active local profile.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_jwt_uuid_sub()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth.jwt()->>'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (auth.jwt()->>'sub')::UUID
    ELSE NULL
  END
$$;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS external_actor_id TEXT;

DO $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.enforce_audit_log_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_profile_id UUID;
  v_email TEXT;
BEGIN
  v_actor_profile_id := COALESCE(
    NULLIF(current_setting('app.audit_actor_profile_id', TRUE), '')::UUID,
    public.current_profile_id(),
    public.current_jwt_uuid_sub()
  );

  IF v_actor_profile_id IS NULL THEN
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

  SELECT p.email INTO v_email
    FROM public.profiles p
   WHERE p.id = v_actor_profile_id;

  IF v_email IS NULL THEN
    SELECT au.email INTO v_email
      FROM auth.users au
     WHERE au.id = v_actor_profile_id;
  END IF;

  NEW.actor_type := 'user';
  NEW.external_actor_id := NULL;
  NEW.user_id := v_actor_profile_id;
  NEW.user_email := COALESCE(v_email, NEW.user_email);
  NEW.created_at := NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_enforce_fields ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_enforce_fields
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_log_fields();

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id UUID;
  v_action TEXT;
  v_resource TEXT;
  v_resource_id TEXT;
  v_summary TEXT;
  v_metadata JSONB;
  v_actor_profile_id UUID;
  v_actor_type TEXT := 'user';
  v_external_actor_id TEXT := NULL;
BEGIN
  v_resource := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    IF v_resource = 'organisations' THEN
      v_org_id := NEW.id;
    ELSE
      v_org_id := NEW.org_id;
    END IF;
    v_resource_id := NEW.id::TEXT;
    v_summary := 'Created ' || v_resource;
    v_metadata := jsonb_build_object('after', to_jsonb(NEW));

  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    IF v_resource = 'organisations' THEN
      v_org_id := NEW.id;
    ELSE
      v_org_id := NEW.org_id;
    END IF;
    v_resource_id := NEW.id::TEXT;
    v_summary := 'Updated ' || v_resource;
    v_metadata := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));

  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    IF v_resource = 'organisations' THEN
      v_org_id := OLD.id;
    ELSE
      v_org_id := OLD.org_id;
    END IF;
    v_resource_id := OLD.id::TEXT;
    v_summary := 'Deleted ' || v_resource;
    v_metadata := jsonb_build_object('before', to_jsonb(OLD));
  END IF;

  v_actor_profile_id := COALESCE(
    NULLIF(current_setting('app.audit_actor_profile_id', TRUE), '')::UUID,
    public.current_profile_id(),
    public.current_jwt_uuid_sub()
  );

  IF v_actor_profile_id IS NULL THEN
    v_actor_type := 'system';
    v_external_actor_id := COALESCE(
      NULLIF(current_setting('app.audit_external_actor_id', TRUE), ''),
      'service_role:' || v_resource
    );
  END IF;

  INSERT INTO public.audit_logs (
    org_id,
    action,
    resource,
    resource_id,
    summary,
    metadata,
    actor_type,
    external_actor_id
  ) VALUES (
    v_org_id,
    v_action,
    v_resource,
    v_resource_id,
    v_summary,
    v_metadata,
    v_actor_type,
    v_external_actor_id
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMIT;
