-- Fix: FOR ALL policies apply their USING expression as WITH CHECK on INSERT too,
-- which blocks new-user signups. Switch to explicit SELECT/UPDATE/DELETE policies.

-- ── ORGANISATIONS ───────────────────────────────────────────
DROP POLICY IF EXISTS "org_insert" ON organisations;
DROP POLICY IF EXISTS "org_select_update_delete" ON organisations;

CREATE POLICY "org_insert" ON organisations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "org_select_update_delete" ON organisations
  FOR SELECT USING (id = current_user_org_id());

CREATE POLICY "org_update_delete" ON organisations
  FOR UPDATE USING (id = current_user_org_id());

-- ── PROFILES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "profile_insert" ON profiles;
DROP POLICY IF EXISTS "profile_select_update_delete" ON profiles;

CREATE POLICY "profile_insert" ON profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "profile_select" ON profiles
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "profile_update" ON profiles
  FOR UPDATE USING (org_id = current_user_org_id());

-- ── HEDGE POLICIES ───────────────────────────────────────────
DROP POLICY IF EXISTS "org_isolation" ON hedge_policies;

CREATE POLICY "hedge_policies_insert" ON hedge_policies
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "hedge_policies_select" ON hedge_policies
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "hedge_policies_update" ON hedge_policies
  FOR UPDATE USING (org_id = current_user_org_id());

-- ── FX EXPOSURES ─────────────────────────────────────────────
DROP POLICY IF EXISTS "org_isolation" ON fx_exposures;

CREATE POLICY "fx_exposures_insert" ON fx_exposures
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "fx_exposures_select" ON fx_exposures
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "fx_exposures_update_delete" ON fx_exposures
  FOR DELETE USING (org_id = current_user_org_id());

-- ── UPLOAD BATCHES ───────────────────────────────────────────
DROP POLICY IF EXISTS "upload_batches_insert" ON upload_batches;
DROP POLICY IF EXISTS "upload_batches_select_update_delete" ON upload_batches;

CREATE POLICY "upload_batches_insert" ON upload_batches
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "upload_batches_select" ON upload_batches
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "upload_batches_update" ON upload_batches
  FOR UPDATE USING (org_id = current_user_org_id());

-- ── HEDGE POSITIONS ──────────────────────────────────────────
DROP POLICY IF EXISTS "org_isolation" ON hedge_positions;

CREATE POLICY "hedge_positions_insert" ON hedge_positions
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "hedge_positions_select" ON hedge_positions
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "hedge_positions_update_delete" ON hedge_positions
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "hedge_positions_delete" ON hedge_positions
  FOR DELETE USING (org_id = current_user_org_id());
