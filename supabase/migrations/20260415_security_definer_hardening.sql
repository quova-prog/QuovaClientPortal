-- ============================================================
-- ORBIT: Security Definer Hardening (Search Path Injection)
-- Closes search-path injection vectors in existing SECURITY DEFINER RPCs.
-- ============================================================

-- From 001_initial_schema.sql
ALTER FUNCTION public.current_user_org_id() SET search_path = public, auth;

-- From 20260329_role_rls.sql
ALTER FUNCTION public.current_user_role() SET search_path = public, auth;

-- From 20260331_security_hardening.sql
ALTER FUNCTION public.prevent_audit_log_mutation() SET search_path = public, auth;

-- From 20260403_support_data_ops.sql
ALTER FUNCTION public.support_change_user_role(UUID, TEXT, TEXT) SET search_path = public, auth;

-- From 20260403_support_portal.sql
ALTER FUNCTION public.is_support_user() SET search_path = public, auth;
ALTER FUNCTION public.get_support_user_role() SET search_path = public, auth;
ALTER FUNCTION public.enforce_support_audit_log_fields() SET search_path = public, auth;
ALTER FUNCTION public.prevent_support_audit_log_mutation() SET search_path = public, auth;

-- From 20260409_support_audit_log_rpc.sql
ALTER FUNCTION public.support_write_audit_log(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) SET search_path = public, auth;
