-- WorkOS Phase 0 RLS probe.
-- Run this in the Supabase SQL editor for the staging validation project.
-- The table is disposable and must not become part of product auth.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workos_phase0_rls_probe (
  id TEXT PRIMARY KEY CHECK (id IN ('allowed', 'wrong-org', 'wrong-user')),
  workos_user_id TEXT NOT NULL,
  workos_org_id TEXT NOT NULL,
  visible_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.workos_phase0_rls_probe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workos_phase0_select_matching_claims"
  ON public.workos_phase0_rls_probe;

CREATE POLICY "workos_phase0_select_matching_claims"
  ON public.workos_phase0_rls_probe
  FOR SELECT
  TO authenticated
  USING (
    workos_user_id = auth.jwt()->>'sub'
    AND workos_org_id = auth.jwt()->>'org_id'
  );

REVOKE ALL ON public.workos_phase0_rls_probe FROM anon;
REVOKE ALL ON public.workos_phase0_rls_probe FROM authenticated;
GRANT SELECT ON public.workos_phase0_rls_probe TO authenticated;

CREATE INDEX IF NOT EXISTS idx_workos_phase0_rls_probe_claims
  ON public.workos_phase0_rls_probe(workos_user_id, workos_org_id);

COMMIT;

-- Cleanup command after Phase 0 is fully recorded:
-- DROP TABLE IF EXISTS public.workos_phase0_rls_probe;
