-- WorkOS safe legacy support/admin helper bridge.
--
-- Some customer-facing RLS policies also include support-path OR branches.
-- Those support helpers must tolerate WorkOS customer tokens whose `sub` is a
-- string like `user_...`, because the legacy Supabase uid helper casts `sub`
-- to UUID.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_jwt_uuid_sub()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth.jwt()->>'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (auth.jwt()->>'sub')::UUID
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.current_support_bank_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  WITH identity AS (
    SELECT
      public.current_workos_support_user_id() AS workos_support_user_id,
      public.current_jwt_uuid_sub() AS legacy_support_user_id
  )
  SELECT su.bank_id
    FROM public.support_users su
    CROSS JOIN identity i
   WHERE su.id = COALESCE(i.workos_support_user_id, i.legacy_support_user_id)
     AND su.is_active = TRUE
     AND (
       i.workos_support_user_id IS NOT NULL
       OR auth.jwt()->>'aal' = 'aal2'
     )
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_quova_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  WITH identity AS (
    SELECT
      public.current_workos_support_user_id() AS workos_support_user_id,
      public.current_jwt_uuid_sub() AS legacy_support_user_id
  )
  SELECT EXISTS (
    SELECT 1
      FROM public.support_users su
      CROSS JOIN identity i
     WHERE su.id = COALESCE(i.workos_support_user_id, i.legacy_support_user_id)
       AND su.is_active = TRUE
       AND su.bank_id IS NULL
       AND su.role = 'support_admin'
       AND (
         i.workos_support_user_id IS NOT NULL
         OR auth.jwt()->>'aal' = 'aal2'
       )
  )
$$;

COMMIT;
