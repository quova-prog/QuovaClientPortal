-- WorkOS Phase 3 provisioning support.
--
-- Apply this in the Supabase SQL editor before enabling
-- VITE_AUTH_PROVIDER=workos. It is intentionally separate from the Phase 4
-- RLS re-key cutover SQL.

CREATE TABLE IF NOT EXISTS public.workos_provisioning_locks (
  workos_user_id TEXT PRIMARY KEY,
  email TEXT,
  org_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'complete', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  local_org_id UUID,
  local_profile_id UUID,
  workos_org_id TEXT,
  error TEXT,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.workos_provisioning_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workos_provisioning_locks FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_workos_provisioning_locks_status
  ON public.workos_provisioning_locks(status, last_attempt_at);
