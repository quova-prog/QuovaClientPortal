-- ============================================================
-- SECURITY FIX: Prevent support audit log forgery
--
-- The support_audit_logs INSERT policy lets any support user
-- supply arbitrary target_org_id, target_org_name, action,
-- resource, summary, and metadata. A rogue support user could
-- create misleading permanent cross-tenant audit records.
--
-- Fix: Replace direct INSERT with an RPC that:
-- 1. Validates action against an allowed enum
-- 2. Resolves target_org_name from target_org_id server-side
-- 3. Enforces actor identity (existing trigger handles this too)
-- 4. Revoke direct INSERT from authenticated users
-- ============================================================

CREATE OR REPLACE FUNCTION support_write_audit_log(
  p_action       TEXT,
  p_resource     TEXT,
  p_resource_id  TEXT DEFAULT NULL,
  p_target_org_id UUID DEFAULT NULL,
  p_summary      TEXT DEFAULT '',
  p_metadata     JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id    UUID;
  v_email       TEXT;
  v_role        TEXT;
  v_org_name    TEXT;
  v_allowed_actions TEXT[] := ARRAY[
    'login', 'logout', 'view_tenant', 'impersonate', 'end_impersonate',
    'view_audit_log', 'update_user', 'data_correction', 'session_timeout'
  ];
BEGIN
  -- 1. Verify caller is an active support user
  v_actor_id := auth.uid();
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = v_actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Access denied: active support user required';
  END IF;

  -- 2. Validate action against allowed enum
  IF NOT (p_action = ANY(v_allowed_actions)) THEN
    RAISE EXCEPTION 'Invalid audit action: %. Allowed: %', p_action, v_allowed_actions;
  END IF;

  -- 3. Resolve target_org_name from target_org_id server-side
  --    (client cannot fake the org name)
  IF p_target_org_id IS NOT NULL THEN
    SELECT name INTO v_org_name
      FROM organisations
     WHERE id = p_target_org_id;
    -- If org not found, still log but with null name
  END IF;

  -- 4. Insert with server-enforced fields
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata, created_at
  ) VALUES (
    v_actor_id, v_email, v_role,
    p_target_org_id, v_org_name,
    p_action, p_resource, p_resource_id,
    p_summary, p_metadata, NOW()
  );
END;
$$;

-- Grant execute to authenticated (the function itself validates support role)
REVOKE ALL ON FUNCTION support_write_audit_log(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_write_audit_log(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated;

-- Revoke direct INSERT on support_audit_logs from authenticated users.
-- Only SECURITY DEFINER functions (RPCs) can insert now.
-- Note: The existing data correction RPCs already insert server-side.
DROP POLICY IF EXISTS "support_audit_logs_insert" ON support_audit_logs;
CREATE POLICY "support_audit_logs_insert_blocked" ON support_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (false);
