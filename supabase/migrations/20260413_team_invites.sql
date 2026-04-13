-- ============================================================
-- QUOVA: Team Invites + Team Management RPCs
-- Enables multi-user orgs with invite → accept → role management
-- ============================================================

-- ── Invites table ──────────────────────────────────────────────
CREATE TABLE invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, email)
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Admins can see invites for their org
CREATE POLICY "invites_select" ON invites
  FOR SELECT USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

-- Admins can create invites
CREATE POLICY "invites_insert" ON invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

-- Admins can delete (revoke) invites
CREATE POLICY "invites_delete" ON invites
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );

CREATE INDEX idx_invites_org ON invites(org_id);
CREATE INDEX idx_invites_email ON invites(email);

-- ── Accept invite RPC ──────────────────────────────────────────
-- Called by a newly signed-up user to join an existing org via invite
CREATE OR REPLACE FUNCTION accept_invite(p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_invite  RECORD;
  v_email   TEXT;
  v_existing_org UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get user email
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Get invite
  SELECT * INTO v_invite FROM invites WHERE id = p_invite_id;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already accepted';
  END IF;

  IF v_invite.expires_at < NOW() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  IF LOWER(v_invite.email) != LOWER(v_email) THEN
    RAISE EXCEPTION 'This invite was sent to a different email address';
  END IF;

  -- Check if user already has a profile (from self-signup)
  SELECT org_id INTO v_existing_org FROM profiles WHERE id = v_user_id;

  IF v_existing_org IS NOT NULL THEN
    -- User already onboarded — move them to the invited org
    UPDATE profiles
    SET org_id = v_invite.org_id, role = v_invite.role, updated_at = NOW()
    WHERE id = v_user_id;
  ELSE
    -- Create profile for the invited user
    INSERT INTO profiles (id, org_id, full_name, role)
    VALUES (
      v_user_id,
      v_invite.org_id,
      COALESCE(
        (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = v_user_id),
        SPLIT_PART(v_email, '@', 1)
      ),
      v_invite.role
    );
  END IF;

  -- Mark invite as accepted
  UPDATE invites SET accepted_at = NOW() WHERE id = p_invite_id;

  -- Create default notification preferences for the new member
  INSERT INTO notification_preferences (user_id, org_id, email_urgent, email_digest)
  VALUES (
    v_user_id,
    v_invite.org_id,
    CASE WHEN v_invite.role = 'viewer' THEN false ELSE true END,
    CASE WHEN v_invite.role = 'admin' THEN true ELSE false END
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN v_invite.org_id;
END;
$$;

REVOKE ALL ON FUNCTION accept_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invite(UUID) TO authenticated;

-- ── Update member role RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_member_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_org  UUID;
  v_target_org  UUID;
  v_admin_count INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  -- Get caller info
  SELECT role, org_id INTO v_caller_role, v_caller_org
  FROM profiles WHERE id = v_caller_id;

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  -- Ensure target is in same org
  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_target_user_id;

  IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organisation';
  END IF;

  -- Prevent demoting the last admin
  IF p_new_role != 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM profiles
    WHERE org_id = v_caller_org AND role = 'admin' AND id != p_target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin. Promote another user first.';
    END IF;
  END IF;

  -- Self-demotion is allowed (as long as not last admin — checked above)
  UPDATE profiles
  SET role = p_new_role, updated_at = NOW()
  WHERE id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION update_member_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_member_role(UUID, TEXT) TO authenticated;

-- ── Remove member RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION remove_member(p_target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_org  UUID;
  v_target_org  UUID;
  v_admin_count INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get caller info
  SELECT role, org_id INTO v_caller_role, v_caller_org
  FROM profiles WHERE id = v_caller_id;

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can remove members';
  END IF;

  -- Cannot remove yourself
  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot remove yourself from the organisation';
  END IF;

  -- Ensure target is in same org
  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_target_user_id;

  IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
    RAISE EXCEPTION 'User not found in your organisation';
  END IF;

  -- Delete profile (cascades notification_preferences via FK)
  DELETE FROM profiles WHERE id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION remove_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_member(UUID) TO authenticated;

-- ── Admin SELECT on notification_preferences (for team overview) ──
CREATE POLICY "notif_prefs_admin_select" ON notification_preferences
  FOR SELECT USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );
