-- ============================================================
-- ORBIT: SOC2 Organisation Teardown
-- Allows admins to delete their own organization.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_organisation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_count INT;
BEGIN
  -- Get user's org id and role
  SELECT org_id, role INTO v_org_id, v_role
    FROM profiles
   WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of an organisation';
  END IF;

  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'Only an admin can delete the organisation';
  END IF;

  -- Verify other members
  -- Note: Deleting the org cascades to all profiles, removing their membership.
  SELECT count(*) INTO v_count FROM profiles WHERE org_id = v_org_id;

  -- Because ON DELETE CASCADE is set on all tables referencing organisations,
  -- this completely purges all tenant data except auth.users which remain orphaned (but clean).
  DELETE FROM organisations WHERE id = v_org_id;
END;
$$;
