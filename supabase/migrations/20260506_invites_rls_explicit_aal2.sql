-- ============================================================
-- ORBIT: Pin AAL2 directly into the `invites` RLS policies.
--
-- The three existing policies on `invites` (select, insert, delete)
-- were defined in 20260413_team_invites.sql with predicates:
--   org_id = current_user_org_id() AND current_user_role() = 'admin'
--
-- Both helper functions were rewritten in 20260415_aal2_enforcement.sql
-- to return NULL unless (auth.jwt()->>'aal') = 'aal2', which means
-- AAL1 admins are *currently* blocked from creating, listing, or
-- revoking invites. That's correct behavior, but it depends on the
-- transitive guarantee inside two helper functions. If anyone
-- refactors current_user_org_id() or current_user_role() to drop the
-- AAL2 predicate, this entire surface re-opens silently.
--
-- This migration adds a third predicate directly to each policy:
--   AND (auth.jwt()->>'aal') = 'aal2'
-- as defense-in-depth. Behavior under the current schema is
-- unchanged; a future helper-function refactor cannot regress
-- invite RLS without also explicitly removing this predicate.
--
-- accept_invite()'s UPDATE on invites is unaffected — that function
-- is SECURITY DEFINER and bypasses RLS, which is intentional (the
-- bootstrap path runs at AAL1 because brand-new users have no MFA
-- enrolled yet).
--
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

-- ── invites_select ─────────────────────────────────────────────
DROP POLICY IF EXISTS "invites_select" ON invites;

CREATE POLICY "invites_select" ON invites
  FOR SELECT USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
    AND (auth.jwt()->>'aal') = 'aal2'
  );

-- ── invites_insert ─────────────────────────────────────────────
DROP POLICY IF EXISTS "invites_insert" ON invites;

CREATE POLICY "invites_insert" ON invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
    AND (auth.jwt()->>'aal') = 'aal2'
  );

-- ── invites_delete ─────────────────────────────────────────────
DROP POLICY IF EXISTS "invites_delete" ON invites;

CREATE POLICY "invites_delete" ON invites
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
    AND (auth.jwt()->>'aal') = 'aal2'
  );

COMMIT;
