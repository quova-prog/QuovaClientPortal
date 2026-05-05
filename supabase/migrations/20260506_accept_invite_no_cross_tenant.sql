-- ============================================================
-- ORBIT: Block silent cross-tenant moves via accept_invite()
--
-- The original accept_invite() (defined in 20260413_team_invites.sql)
-- detected that a calling user already had a profile and unconditionally
-- rewrote profiles.org_id and profiles.role to whatever the invite
-- specified. With no membership-already-elsewhere check, any admin of
-- any org could create an invite for an email that belongs to a member
-- of a different org and silently pull that user out of their current
-- tenant the moment they clicked through.
--
-- This migration re-creates accept_invite() with one extra guard:
--   IF v_existing_org IS NOT NULL AND v_existing_org != v_invite.org_id
--     THEN RAISE EXCEPTION ...
-- and otherwise leaves the function semantically identical.
--
-- Same-org re-acceptance (no-op role refresh) is still allowed in
-- the rare case it occurs. New-user (no existing profile) acceptance
-- is unchanged.
--
-- Bootstrap paths (onboard_new_user, this function for genuinely
-- new users) remain AAL-agnostic because new users have no AAL2
-- session yet — that's by design.
--
-- Idempotent: re-running this migration is a no-op (CREATE OR REPLACE).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION accept_invite(p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_invite       RECORD;
  v_email        TEXT;
  v_existing_org UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get the caller's verified email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Get the invite row
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

  -- Cross-tenant move guard. If the user already has a profile in some
  -- *other* org, refuse to silently move them. They must explicitly
  -- leave their current org before accepting this invite.
  SELECT org_id INTO v_existing_org FROM profiles WHERE id = v_user_id;

  IF v_existing_org IS NOT NULL AND v_existing_org != v_invite.org_id THEN
    RAISE EXCEPTION 'You already belong to another organization. Leave it first to accept this invite.';
  END IF;

  IF v_existing_org IS NOT NULL THEN
    -- Same-org re-acceptance: refresh role only. (Rare path; a stale
    -- invite or a profile that was created out-of-band could land here.)
    UPDATE profiles
    SET role = v_invite.role, updated_at = NOW()
    WHERE id = v_user_id;
  ELSE
    -- New-user path: create profile in the invited org.
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

  -- Default notification preferences for the new member
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

-- Grants are preserved by CREATE OR REPLACE; re-asserting for clarity.
REVOKE ALL ON FUNCTION accept_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invite(UUID) TO authenticated;

COMMIT;
