-- ============================================================
-- SECURITY FIX: Prevent audit log content forgery
--
-- The existing BEFORE INSERT trigger enforces identity (user_id,
-- user_email, created_at) but the client can still supply arbitrary
-- action, resource, summary, and metadata values. Any tenant user
-- can fabricate immutable audit history entries.
--
-- Fix: Replace direct client INSERT with an RPC that validates
-- action against an allowed enum and sanitises content fields.
-- SECURITY DEFINER triggers (SOC2 mandatory audit) still INSERT
-- directly and bypass RLS.
-- ============================================================

-- ── 1. RPC for validated audit log writes ───────────────────

CREATE OR REPLACE FUNCTION write_audit_log(
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
  v_uid        UUID;
  v_email      TEXT;
  v_org_id     UUID;
  v_allowed_actions TEXT[] := ARRAY[
    'create', 'update', 'delete', 'login', 'logout', 'export', 'upload'
  ];
BEGIN
  -- 1. Authenticate
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'audit_logs: authenticated user required';
  END IF;

  -- 2. Resolve org_id from profile (server-side — cannot be forged)
  SELECT org_id INTO v_org_id
    FROM profiles
   WHERE id = v_uid;

  IF v_org_id IS NULL THEN
    -- During signup the profile may not exist yet — skip silently
    RETURN;
  END IF;

  -- 3. Resolve email from auth.users
  SELECT email INTO v_email
    FROM auth.users
   WHERE id = v_uid;

  -- 4. Validate action
  IF NOT (p_action = ANY(v_allowed_actions)) THEN
    RAISE EXCEPTION 'Invalid audit action: %. Allowed: %', p_action, v_allowed_actions;
  END IF;

  -- 5. Validate resource (non-empty, max 100 chars)
  IF trim(COALESCE(p_resource, '')) = '' THEN
    RAISE EXCEPTION 'audit_logs: resource is required';
  END IF;
  p_resource := left(trim(p_resource), 100);

  -- 6. Sanitise summary (max 500 chars)
  p_summary := left(COALESCE(p_summary, ''), 500);

  -- 7. Sanitise resource_id (max 100 chars)
  p_resource_id := left(COALESCE(p_resource_id, ''), 100);

  -- 8. Insert — the BEFORE INSERT trigger will overwrite
  --    user_id, user_email, created_at as an extra safety net
  INSERT INTO audit_logs (
    org_id, user_id, user_email,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    v_org_id, v_uid, v_email,
    p_action, p_resource, NULLIF(p_resource_id, ''),
    p_summary, p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION write_audit_log(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION write_audit_log(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;


-- ── 2. Block direct client INSERT ───────────────────────────
-- SECURITY DEFINER functions (triggers, RPCs) bypass RLS and
-- can still INSERT directly. Only client-initiated PostgREST
-- INSERTs are blocked.

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert_blocked" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (false);
