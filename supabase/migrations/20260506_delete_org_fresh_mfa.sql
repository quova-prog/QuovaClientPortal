-- ============================================================
-- ORBIT: Step-up MFA for delete_organisation (5-minute window)
--
-- The 20260506_aal2_team_management migration AAL2-hardened
-- delete_organisation, which closes the password-only-attacker case
-- (an AAL1 token is rejected). It does NOT close the case where
-- an attacker has somehow acquired a current AAL2 session token but
-- cannot produce a fresh TOTP code — e.g. cookie theft after the
-- legitimate user MFA'd hours ago, or a long-running browser tab
-- left unattended.
--
-- delete_organisation is the only IRREVERSIBLE tenant-side RPC, so
-- this migration adds a fresh-MFA step-up check: the JWT's `amr`
-- claim must include a `totp` entry whose `timestamp` is within the
-- last 5 minutes. The legitimate UI flow already calls
-- mfa.challengeAndVerify() immediately before invoking the RPC, so
-- the timestamp is typically <10 seconds old when the function runs.
-- A stolen-but-stale-AAL2-session attacker cannot produce a fresh
-- TOTP and is rejected.
--
-- Window:   300 seconds (5 minutes)
-- Methods:  TOTP only — SMS / email-as-MFA are weak factors and
--           should not satisfy the step-up gate even if Orbit ever
--           adds them as enrollable factors.
--
-- This is additive on top of the existing AAL2 + admin-role + org-
-- membership checks. All existing guards are preserved verbatim.
--
-- Behavior summary
-- - Legit user clicking Delete in the UI: SettingsPage prompts for
--   TOTP, calls challengeAndVerify(), then this RPC. Window check
--   passes (timestamp ~0s old). Behaviour unchanged for them.
-- - Stale AAL2 token attacker: rejected with a clear retry message;
--   they are NOT signed out and the rest of their session is
--   unaffected. Re-entering TOTP refreshes amr.timestamp and a
--   subsequent call would succeed.
-- - AAL1 caller: blocked at the AAL2 check before reaching the
--   step-up check.
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION delete_organisation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id        UUID;
  v_role          TEXT;
  v_last_mfa_ts   BIGINT;
  v_max_age_sec   CONSTANT INT := 300;  -- 5 minutes
BEGIN
  -- 1. Authentication present
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Session-level AAL2 (verified MFA at some point this session)
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA required to delete an organization';
  END IF;

  -- 3. Step-up: most recent TOTP verification within the window.
  --    The amr claim is a JSONB array of { method, timestamp }
  --    entries; we take the MAX timestamp across totp entries.
  --    COALESCE protects against a missing/null amr claim.
  SELECT MAX((entry->>'timestamp')::BIGINT)
    INTO v_last_mfa_ts
    FROM jsonb_array_elements(COALESCE(auth.jwt()->'amr', '[]'::jsonb)) AS entry
   WHERE entry->>'method' = 'totp';

  IF v_last_mfa_ts IS NULL
     OR (EXTRACT(EPOCH FROM NOW())::BIGINT - v_last_mfa_ts) > v_max_age_sec
  THEN
    RAISE EXCEPTION 'Recent MFA verification required (within last 5 minutes). Re-enter your authenticator code and try again.';
  END IF;

  -- 4. Caller must be admin of an org
  SELECT org_id, role INTO v_org_id, v_role
    FROM profiles
   WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of an organization';
  END IF;

  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'Only an admin can delete the organization';
  END IF;

  -- 5. Cascade-delete the org. ON DELETE CASCADE on every
  --    org_id-keyed table cleans up the rest.
  DELETE FROM organisations WHERE id = v_org_id;
END;
$$;

COMMIT;
