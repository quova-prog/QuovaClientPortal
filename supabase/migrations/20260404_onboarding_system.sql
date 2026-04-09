-- ============================================================
-- Orbit Onboarding System — State Machine + Discovery
-- Phase 1 MVP: flat file adapter, AI mapping, validate, go live
-- ============================================================

-- ── Onboarding Sessions ────────────────────────────────────
-- One session per org. Tracks state machine: setup→connect→discover→validate→live

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup','connect','discover','validate','live','error')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  current_step_started_at TIMESTAMPTZ DEFAULT now(),
  error_message           TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_by              UUID NOT NULL REFERENCES auth.users(id),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one session per org (can be reset by support if needed)
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_org_id_key ON onboarding_sessions(org_id);

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_sessions_select" ON onboarding_sessions
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "onboarding_sessions_insert" ON onboarding_sessions
  FOR INSERT WITH CHECK (org_id = current_user_org_id() AND created_by = auth.uid());

CREATE POLICY "onboarding_sessions_update" ON onboarding_sessions
  FOR UPDATE USING (org_id = current_user_org_id())
  WITH CHECK (org_id = current_user_org_id());

-- ── Onboarding Events (state transition log) ──────────────

CREATE TABLE IF NOT EXISTS onboarding_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  event_type   TEXT NOT NULL,  -- 'step_completed', 'error', 'retry', 'manual_override'
  event_data   JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_events_select" ON onboarding_events
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

CREATE POLICY "onboarding_events_insert" ON onboarding_events
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

-- ── Organization Profiles (collected in SETUP step) ────────

CREATE TABLE IF NOT EXISTS organization_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE UNIQUE,
  functional_currency   CHAR(3) NOT NULL,
  reporting_currencies  TEXT[] NOT NULL DEFAULT '{}',
  fiscal_year_end_month INT CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  transaction_currencies TEXT[] NOT NULL DEFAULT '{}',
  entities              JSONB NOT NULL DEFAULT '[]',   -- [{name, country, functional_currency}]
  industry              TEXT,
  annual_revenue_band   TEXT,
  hedging_policy_url    TEXT,
  bank_relationships    TEXT[] NOT NULL DEFAULT '{}',
  reporting_cadence     TEXT,
  fx_pain_points        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organization_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_profiles_select" ON organization_profiles
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "organization_profiles_insert" ON organization_profiles
  FOR INSERT WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "organization_profiles_update" ON organization_profiles
  FOR UPDATE USING (org_id = current_user_org_id())
  WITH CHECK (org_id = current_user_org_id());

-- ── Schema Discoveries ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_discoveries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  connection_id           UUID,  -- FK to erp_connections if applicable
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  raw_schema              JSONB,        -- {columns: [{name, dataType, sampleValues}], rowCount}
  candidate_tables        JSONB,
  sample_data             JSONB,
  ai_analysis             JSONB,        -- full AI result
  confidence_score        NUMERIC(3,2), -- overall confidence 0.00–1.00
  tables_scanned          INT,
  tables_identified       INT,
  currencies_found        TEXT[] NOT NULL DEFAULT '{}',
  estimated_exposure_count INT,
  error_message           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schema_discoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schema_discoveries_select" ON schema_discoveries
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

CREATE POLICY "schema_discoveries_insert" ON schema_discoveries
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

CREATE POLICY "schema_discoveries_update" ON schema_discoveries
  FOR UPDATE USING (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM onboarding_sessions WHERE org_id = current_user_org_id()
    )
  );

-- ── Field Mappings ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_id    UUID NOT NULL REFERENCES schema_discoveries(id) ON DELETE CASCADE,
  source_table    TEXT NOT NULL,
  source_field    TEXT NOT NULL,
  source_data_type TEXT,
  sample_values   JSONB NOT NULL DEFAULT '[]',
  target_entity   TEXT NOT NULL,
  target_field    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','rejected','modified')),
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0,
  ai_reasoning    TEXT,
  human_notes     TEXT,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;

-- RLS via join: field_mappings → schema_discoveries → onboarding_sessions → org
CREATE POLICY "field_mappings_select" ON field_mappings
  FOR SELECT USING (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
  );

CREATE POLICY "field_mappings_insert" ON field_mappings
  FOR INSERT WITH CHECK (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
  );

CREATE POLICY "field_mappings_update" ON field_mappings
  FOR UPDATE USING (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
  )
  WITH CHECK (
    discovery_id IN (
      SELECT sd.id FROM schema_discoveries sd
      JOIN onboarding_sessions os ON os.id = sd.session_id
      WHERE os.org_id = current_user_org_id()
    )
  );

-- ── Mapping Templates (flywheel — org-agnostic) ────────────

CREATE TABLE IF NOT EXISTS mapping_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_type            TEXT NOT NULL,
  erp_version         TEXT,
  template_name       TEXT NOT NULL,
  mappings            JSONB NOT NULL,
  usage_count         INT NOT NULL DEFAULT 0,
  success_rate        NUMERIC(3,2),
  created_from_org_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mapping_templates ENABLE ROW LEVEL SECURITY;

-- Templates are read-only for all authenticated users (org-agnostic reference data)
CREATE POLICY "mapping_templates_select" ON mapping_templates
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── RPC: advance_onboarding_status ─────────────────────────

CREATE OR REPLACE FUNCTION advance_onboarding_status(
  p_session_id UUID,
  p_new_status  TEXT,
  p_reason      TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status TEXT;
  v_org_id     UUID;
BEGIN
  -- Verify caller owns this session
  SELECT status, org_id
    INTO v_old_status, v_org_id
    FROM onboarding_sessions
   WHERE id = p_session_id
     AND org_id = current_user_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  -- Validate new status
  IF p_new_status NOT IN ('setup','connect','discover','validate','live','error') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  -- Enforce state machine transitions (forward-only, except 'error' which is always allowed)
  IF p_new_status != 'error' THEN
    DECLARE
      v_allowed BOOLEAN;
    BEGIN
      v_allowed := CASE v_old_status
        WHEN 'setup'    THEN p_new_status IN ('connect', 'setup')
        WHEN 'connect'  THEN p_new_status IN ('discover', 'connect', 'setup')
        WHEN 'discover' THEN p_new_status IN ('validate', 'discover', 'connect')
        WHEN 'validate' THEN p_new_status IN ('live', 'validate', 'discover')
        WHEN 'live'     THEN FALSE  -- terminal state
        WHEN 'error'    THEN TRUE   -- can recover to any state
        ELSE FALSE
      END;
      IF NOT v_allowed THEN
        RAISE EXCEPTION 'Invalid transition: % → %', v_old_status, p_new_status;
      END IF;
    END;
  END IF;

  -- Update session
  UPDATE onboarding_sessions SET
    status                  = p_new_status,
    current_step_started_at = now(),
    updated_at              = now(),
    completed_at            = CASE WHEN p_new_status = 'live' THEN now() ELSE NULL END
  WHERE id = p_session_id;

  -- Log the transition
  INSERT INTO onboarding_events (session_id, from_status, to_status, event_type, event_data)
  VALUES (
    p_session_id,
    v_old_status,
    p_new_status,
    'step_completed',
    jsonb_build_object('reason', p_reason, 'actor', auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION advance_onboarding_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_onboarding_status(UUID, TEXT, TEXT) TO authenticated;
