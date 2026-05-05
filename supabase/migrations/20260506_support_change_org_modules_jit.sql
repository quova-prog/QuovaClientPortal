-- ============================================================
-- ORBIT: Add JIT access enforcement to support_change_org_modules
--
-- The 20260430_soc2_support_rpc_aal2 migration AAL2-hardened seven
-- support mutation RPCs. Six of them also call has_support_access_to(...)
-- to require an active org-scoped JIT grant before mutating tenant
-- data. support_change_org_modules was the lone exception — it got
-- the AAL2 check but not the JIT check.
--
-- Effect: any support_admin with an AAL2 session could rewrite
-- ANY tenant's organisations.modules array via direct REST call,
-- without first running through the JIT request flow that every
-- other support write requires. Standing cross-tenant write access
-- on one specific column.
--
-- This migration re-creates support_change_org_modules with a single
-- new block inserted between the org-existence check and the UPDATE,
-- mirroring the peer pattern used by support_change_user_role et al.:
--
--   IF NOT has_support_access_to(p_org_id) THEN
--     RAISE EXCEPTION 'No active access grant ...';
--   END IF;
--
-- All other behavior preserved: AAL2 check, support_admin role check,
-- reason-required check, audit log emission, signature, grants.
--
-- The support-portal UI calls this RPC from inside an <AccessGate>
-- wrapper that already gates rendering behind an active JIT grant,
-- so legitimate users are unaffected. The new block exists purely
-- to defend against direct REST callers (compromised sessions,
-- third-party tools, malicious internal access).
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Safe to re-run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION support_change_org_modules(
  p_org_id   UUID,
  p_modules  TEXT[],
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email   TEXT;
  v_actor_role    TEXT;
  v_old_modules   TEXT[];
  v_org_name      TEXT;
BEGIN
  -- 1. Verify caller is an active support_admin with verified MFA
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true
     AND (auth.jwt()->>'aal') = 'aal2';

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: active support_admin role with AAL2 required';
  END IF;

  -- 2. Validate reason is non-empty
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 3. Fetch current state of the target org
  SELECT modules, name
    INTO v_old_modules, v_org_name
    FROM organisations
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- 4. Require an active JIT grant for the target org. This is the
  --    block that was missing — every other support_* mutation RPC
  --    enforces it; this one previously did not, leaving a standing
  --    cross-tenant write hole on the modules column.
  IF NOT has_support_access_to(p_org_id) THEN
    RAISE EXCEPTION 'No active access grant for this organization. Request JIT access first.';
  END IF;

  -- 5. Apply the change
  UPDATE organisations
     SET modules = p_modules,
         updated_at = now()
   WHERE id = p_org_id;

  -- 6. Write immutable support audit entry
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    auth.uid(),
    v_actor_email,
    v_actor_role,
    p_org_id,
    v_org_name,
    'data_correction',
    'organisation',
    p_org_id::TEXT,
    'Changed org modules: ' || array_to_string(v_old_modules, ',') || ' → ' || array_to_string(p_modules, ',') || ' — ' || p_reason,
    jsonb_build_object(
      'field',     'modules',
      'old_value', v_old_modules,
      'new_value', p_modules,
      'reason',    p_reason
    )
  );
END;
$$;

-- Grants are preserved by CREATE OR REPLACE; re-asserting for clarity.
REVOKE ALL ON FUNCTION support_change_org_modules(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_org_modules(UUID, TEXT[], TEXT) TO authenticated;

COMMIT;
