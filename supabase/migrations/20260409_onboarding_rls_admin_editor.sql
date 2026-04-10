-- ============================================================
-- SECURITY FIX: Restrict onboarding writes to admin/editor
--
-- The RLS policies for onboarding_sessions, organization_profiles,
-- schema_discoveries, and field_mappings only check org membership.
-- A viewer can alter onboarding state, setup answers, discovery
-- outputs, and confirmed mappings through direct Supabase calls.
--
-- Fix: Replace INSERT/UPDATE policies with admin/editor role check
-- using current_user_role() IN ('admin', 'editor').
-- SELECT policies remain org-scoped (viewers can still read).
-- ============================================================

-- ── onboarding_sessions ──────────────────────────────────────

DROP POLICY IF EXISTS "onboarding_sessions_insert" ON onboarding_sessions;
CREATE POLICY "onboarding_sessions_insert" ON onboarding_sessions
  FOR INSERT WITH CHECK (
    org_id = current_user_org_id()
    AND created_by = auth.uid()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "onboarding_sessions_update" ON onboarding_sessions;
CREATE POLICY "onboarding_sessions_update" ON onboarding_sessions
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
  );

-- ── organization_profiles ────────────────────────────────────

DROP POLICY IF EXISTS "organization_profiles_insert" ON organization_profiles;
CREATE POLICY "organization_profiles_insert" ON organization_profiles
  FOR INSERT WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "organization_profiles_update" ON organization_profiles;
CREATE POLICY "organization_profiles_update" ON organization_profiles
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = current_user_org_id()
  );

-- ── schema_discoveries ───────────────────────────────────────

DROP POLICY IF EXISTS "schema_discoveries_insert" ON schema_discoveries;
CREATE POLICY "schema_discoveries_insert" ON schema_discoveries
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "schema_discoveries_update" ON schema_discoveries;
CREATE POLICY "schema_discoveries_update" ON schema_discoveries
  FOR UPDATE USING (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

-- ── field_mappings ───────────────────────────────────────────

DROP POLICY IF EXISTS "field_mappings_insert" ON field_mappings;
CREATE POLICY "field_mappings_insert" ON field_mappings
  FOR INSERT WITH CHECK (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "field_mappings_update" ON field_mappings;
CREATE POLICY "field_mappings_update" ON field_mappings
  FOR UPDATE USING (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
    AND current_user_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
  );
