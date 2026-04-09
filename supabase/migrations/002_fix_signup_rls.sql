-- Fix signup RLS: allow authenticated users to INSERT a new org and their own profile.
-- The existing "org_isolation" ALL policy blocks inserts for brand-new users
-- who don't have a profile/org yet (current_user_org_id() returns NULL).

-- ── ORGANISATIONS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "org_isolation" ON organisations;

-- Anyone authenticated can create an org
CREATE POLICY "org_insert" ON organisations
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can only read/update/delete their own org
CREATE POLICY "org_select_update_delete" ON organisations
  FOR ALL USING (id = current_user_org_id());

-- ── PROFILES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_isolation" ON profiles;

-- Users can insert their own profile row
CREATE POLICY "profile_insert" ON profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Users can only read/update/delete profiles in their org
CREATE POLICY "profile_select_update_delete" ON profiles
  FOR ALL USING (org_id = current_user_org_id());
