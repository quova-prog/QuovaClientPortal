-- ============================================================
-- Hedge Accounting Foundation
-- Accounting configuration, structured designations, period control,
-- append-only measurements/ledgers, and narrow persistence RPCs.
-- ============================================================

-- 1. Org-level accounting configuration. One active row per org.
CREATE TABLE IF NOT EXISTS org_accounting_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  framework             TEXT NOT NULL DEFAULT 'asc815'
                        CHECK (framework IN ('asc815','ifrs9')),
  designation_method    TEXT NOT NULL DEFAULT 'spot'
                        CHECK (designation_method IN ('spot','all_in_forward')),
  forward_points_to     TEXT NOT NULL DEFAULT 'oci'
                        CHECK (forward_points_to IN ('oci','earnings')),
  effectiveness_method  TEXT NOT NULL DEFAULT 'dollar_offset'
                        CHECK (effectiveness_method IN ('critical_terms','dollar_offset','regression')),
  aoci_allocation       TEXT NOT NULL DEFAULT 'pro_rata'
                        CHECK (aoci_allocation IN ('pro_rata','specific_id')),
  assessment_frequency  TEXT NOT NULL DEFAULT 'quarterly'
                        CHECK (assessment_frequency IN ('monthly','quarterly')),
  fair_value_source     TEXT NOT NULL DEFAULT 'quova_indicative'
                        CHECK (fair_value_source IN ('quova_indicative','bank_mtm')),
  fair_value_hierarchy  TEXT NOT NULL DEFAULT 'level_2_indicative'
                        CHECK (fair_value_hierarchy IN ('level_1','level_2_bank','level_2_indicative','level_3')),
  reporting_currency    TEXT NOT NULL DEFAULT 'USD',
  journal_output_mode   TEXT NOT NULL DEFAULT 'draft'
                        CHECK (journal_output_mode IN ('draft','auditor_approved')),
  updated_by            UUID REFERENCES profiles(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_accounting_config_org
  ON org_accounting_config(org_id);

-- 2. Structured hedge-accounting designations.
CREATE TABLE IF NOT EXISTS hedge_designations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id           UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  designation_type      TEXT NOT NULL
                        CHECK (designation_type IN ('cash_flow','fair_value','net_investment')),
  framework             TEXT NOT NULL
                        CHECK (framework IN ('asc815','ifrs9')),
  accounting_status     TEXT NOT NULL DEFAULT 'preparatory'
                        CHECK (accounting_status IN ('preparatory','designated','dedesignated','disqualified')),
  inception_doc_status  TEXT NOT NULL DEFAULT 'missing'
                        CHECK (inception_doc_status IN ('complete','incomplete','missing','backfilled')),
  hedged_risk           TEXT NOT NULL DEFAULT 'fx_spot',
  method                TEXT NOT NULL
                        CHECK (method IN ('spot','all_in_forward')),
  excluded_components   JSONB NOT NULL DEFAULT '{}'::JSONB,
  assessment_method     TEXT
                        CHECK (assessment_method IS NULL OR assessment_method IN ('critical_terms','dollar_offset','regression')),
  inception_doc         TEXT,
  probability_status    TEXT NOT NULL DEFAULT 'probable'
                        CHECK (probability_status IN ('probable','no_longer_probable_still_expected',
                                                      'probable_not_to_occur')),
  functional_currency   TEXT,
  basis_adjustment_usd  NUMERIC(20,2) NOT NULL DEFAULT 0,
  designated_at         TIMESTAMPTZ,
  dedesignated_at       TIMESTAMPTZ,
  dedesignation_reason  TEXT,
  superseded_by_id      UUID REFERENCES hedge_designations(id),
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hedge_designations_designated_docs CHECK (
    accounting_status <> 'designated'
    OR (inception_doc_status = 'complete' AND designated_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hedge_designations_org
  ON hedge_designations(org_id);
CREATE INDEX IF NOT EXISTS idx_hedge_designations_position
  ON hedge_designations(position_id);
CREATE INDEX IF NOT EXISTS idx_hedge_designations_status
  ON hedge_designations(org_id, accounting_status);

-- 3. Hedged items covered by a designation.
CREATE TABLE IF NOT EXISTS hedged_items (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  designation_id             UUID NOT NULL REFERENCES hedge_designations(id) ON DELETE CASCADE,
  exposure_id                UUID REFERENCES fx_exposures(id) ON DELETE SET NULL,
  derived_source             TEXT,
  derived_ref                TEXT,
  forecast_window_start      DATE,
  forecast_window_end        DATE,
  forecast_amount            NUMERIC(20,2) NOT NULL CHECK (forecast_amount > 0),
  affects_earnings_on        DATE,
  earnings_event_source      TEXT CHECK (earnings_event_source IS NULL OR earnings_event_source IN ('exposure','erp','manual','lifecycle_signal')),
  lifecycle_settlement_date  DATE,
  created_by                 UUID REFERENCES profiles(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hedged_items_one_target CHECK (
    (exposure_id IS NOT NULL AND derived_source IS NULL AND derived_ref IS NULL)
    OR (exposure_id IS NULL AND derived_source IS NOT NULL AND derived_ref IS NOT NULL)
  ),
  CONSTRAINT hedged_items_window_order CHECK (
    forecast_window_start IS NULL
    OR forecast_window_end IS NULL
    OR forecast_window_end >= forecast_window_start
  )
);

CREATE INDEX IF NOT EXISTS idx_hedged_items_designation
  ON hedged_items(designation_id);
CREATE INDEX IF NOT EXISTS idx_hedged_items_org_earnings
  ON hedged_items(org_id, affects_earnings_on);

-- 4. Accounting period close/lock control.
CREATE TABLE IF NOT EXISTS accounting_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period      TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at   TIMESTAMPTZ,
  closed_by   UUID REFERENCES profiles(id),
  locked_at   TIMESTAMPTZ,
  locked_by   UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, period)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_org_period
  ON accounting_periods(org_id, period);

-- 5. Fair-value inputs per designation per period.
CREATE TABLE IF NOT EXISTS fair_value_measurements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  designation_id        UUID NOT NULL REFERENCES hedge_designations(id) ON DELETE CASCADE,
  period                TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  fair_value_usd        NUMERIC(20,2) NOT NULL,
  source                TEXT NOT NULL CHECK (source IN ('quova_indicative','bank_mtm')),
  fair_value_hierarchy  TEXT NOT NULL CHECK (fair_value_hierarchy IN ('level_1','level_2_bank','level_2_indicative','level_3')),
  valuation_provider    TEXT,
  source_document_ref   TEXT,
  spot                  NUMERIC(20,8),
  forward_rate          NUMERIC(20,8),
  inputs                JSONB NOT NULL DEFAULT '{}'::JSONB,
  superseded_by_id      UUID REFERENCES fair_value_measurements(id),
  measured_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fair_value_measurements_designation_period
  ON fair_value_measurements(designation_id, period);
CREATE INDEX IF NOT EXISTS idx_fair_value_measurements_org_period
  ON fair_value_measurements(org_id, period);

-- 6. Effectiveness assessment result per designation per period.
CREATE TABLE IF NOT EXISTS effectiveness_assessments (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  designation_id               UUID NOT NULL REFERENCES hedge_designations(id) ON DELETE CASCADE,
  period                       TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  framework                    TEXT NOT NULL CHECK (framework IN ('asc815','ifrs9')),
  method                       TEXT NOT NULL CHECK (method IN ('critical_terms','dollar_offset','regression')),
  actual_derivative_fv         NUMERIC(20,2),
  hypothetical_derivative_fv   NUMERIC(20,2),
  dollar_offset_ratio          NUMERIC(8,4),
  regression_r2                NUMERIC(6,4),
  regression_slope             NUMERIC(8,4),
  ifrs9_economic_relationship  BOOLEAN,
  ifrs9_hedge_ratio            TEXT,
  credit_risk_dominates        BOOLEAN,
  verdict                      TEXT NOT NULL CHECK (verdict IN ('effective','ineffective','inconclusive')),
  rationale                    TEXT NOT NULL,
  superseded_by_id             UUID REFERENCES effectiveness_assessments(id),
  assessed_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_effectiveness_assessments_designation_period
  ON effectiveness_assessments(designation_id, period);
CREATE INDEX IF NOT EXISTS idx_effectiveness_assessments_org_period
  ON effectiveness_assessments(org_id, period);

-- 7. AOCI / CTA reserve ledger.
CREATE TABLE IF NOT EXISTS aoci_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  designation_id      UUID NOT NULL REFERENCES hedge_designations(id) ON DELETE CASCADE,
  hedged_item_id      UUID REFERENCES hedged_items(id) ON DELETE SET NULL,
  period              TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  event_type          TEXT NOT NULL
                      CHECK (event_type IN ('defer','reclassify','ifrs9_ineffective_to_earnings',
                                            'forecast_failed','dedesignate','cost_of_hedging')),
  bucket              TEXT NOT NULL DEFAULT 'aoci_cf' CHECK (bucket IN ('aoci_cf','cta')),
  amount_usd          NUMERIC(20,2) NOT NULL,
  balance_after_usd   NUMERIC(20,2) NOT NULL,
  source_event_ref    TEXT,
  superseded_by_id    UUID REFERENCES aoci_ledger(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aoci_ledger_designation_period
  ON aoci_ledger(designation_id, period);
CREATE INDEX IF NOT EXISTS idx_aoci_ledger_org_period
  ON aoci_ledger(org_id, period);

-- 8. Derivative carrying value / settlement ledger.
CREATE TABLE IF NOT EXISTS derivative_accounting_ledger (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  designation_id                    UUID NOT NULL REFERENCES hedge_designations(id) ON DELETE CASCADE,
  position_id                       UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  draw_id                           UUID REFERENCES hedge_position_draws(id) ON DELETE SET NULL,
  period                            TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  event_type                        TEXT NOT NULL
                                    CHECK (event_type IN ('mtm_to_fair_value','partial_settlement',
                                                          'full_settlement','early_close',
                                                          'excluded_component_amortization')),
  amount_usd                        NUMERIC(20,2) NOT NULL,
  derivative_balance_after_usd      NUMERIC(20,2) NOT NULL,
  fair_value_measurement_id         UUID REFERENCES fair_value_measurements(id),
  source_event_ref                  TEXT,
  superseded_by_id                  UUID REFERENCES derivative_accounting_ledger(id),
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derivative_accounting_ledger_designation_period
  ON derivative_accounting_ledger(designation_id, period);
CREATE INDEX IF NOT EXISTS idx_derivative_accounting_ledger_position
  ON derivative_accounting_ledger(position_id);

-- Keep org boundaries consistent across child rows.
CREATE OR REPLACE FUNCTION enforce_hedge_designation_org_matches_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_position_org UUID;
BEGIN
  SELECT org_id INTO v_position_org FROM hedge_positions WHERE id = NEW.position_id;
  IF v_position_org IS NULL OR v_position_org <> NEW.org_id THEN
    RAISE EXCEPTION 'hedge_designations org_id does not match position org';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hedge_designations_org_match ON hedge_designations;
CREATE TRIGGER trg_hedge_designations_org_match
  BEFORE INSERT OR UPDATE ON hedge_designations
  FOR EACH ROW EXECUTE FUNCTION enforce_hedge_designation_org_matches_position();

CREATE OR REPLACE FUNCTION enforce_hedged_item_org_matches_designation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_designation_org UUID;
  v_exposure_org UUID;
BEGIN
  SELECT org_id INTO v_designation_org FROM hedge_designations WHERE id = NEW.designation_id;
  IF v_designation_org IS NULL OR v_designation_org <> NEW.org_id THEN
    RAISE EXCEPTION 'hedged_items org_id does not match designation org';
  END IF;

  IF NEW.exposure_id IS NOT NULL THEN
    SELECT org_id INTO v_exposure_org FROM fx_exposures WHERE id = NEW.exposure_id;
    IF v_exposure_org IS NULL OR v_exposure_org <> NEW.org_id THEN
      RAISE EXCEPTION 'hedged_items exposure belongs to another organization';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hedged_items_org_match ON hedged_items;
CREATE TRIGGER trg_hedged_items_org_match
  BEFORE INSERT OR UPDATE ON hedged_items
  FOR EACH ROW EXECUTE FUNCTION enforce_hedged_item_org_matches_designation();

CREATE OR REPLACE FUNCTION assert_accounting_period_writable(p_org_id UUID, p_period TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM accounting_periods
  WHERE org_id = p_org_id AND period = p_period;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period % is locked', p_period;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION assert_final_journal_allowed(p_org_id UUID, p_period TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_config org_accounting_config%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM org_accounting_config WHERE org_id = p_org_id;

  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'Accounting configuration is required before final journal output';
  END IF;
  IF v_config.journal_output_mode <> 'auditor_approved' THEN
    RAISE EXCEPTION 'Final output requires auditor-approved journal output mode';
  END IF;
  IF v_config.fair_value_source = 'quova_indicative' THEN
    RAISE EXCEPTION 'Final output requires a non-indicative fair value source';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM hedge_designations hd
    WHERE hd.org_id = p_org_id
      AND hd.accounting_status <> 'designated'
      AND (
        EXISTS (
          SELECT 1 FROM fair_value_measurements fvm
          WHERE fvm.designation_id = hd.id AND fvm.period = p_period
        )
        OR EXISTS (
          SELECT 1 FROM aoci_ledger al
          WHERE al.designation_id = hd.id AND al.period = p_period
        )
        OR EXISTS (
          SELECT 1 FROM derivative_accounting_ledger dal
          WHERE dal.designation_id = hd.id AND dal.period = p_period
        )
      )
  ) THEN
    RAISE EXCEPTION 'Final output requires all included designations to be designated';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM fair_value_measurements
    WHERE org_id = p_org_id
      AND period = p_period
      AND source = 'quova_indicative'
  ) THEN
    RAISE EXCEPTION 'Final output cannot use Quova indicative fair values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM fair_value_measurements
    WHERE org_id = p_org_id
      AND period = p_period
      AND fair_value_hierarchy NOT IN ('level_1','level_2_bank')
  ) THEN
    RAISE EXCEPTION 'Final output requires approved fair value hierarchy';
  END IF;
END $$;

-- RLS for mutable tables.
ALTER TABLE org_accounting_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedge_designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedged_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_accounting_config_select" ON org_accounting_config;
CREATE POLICY "org_accounting_config_select" ON org_accounting_config
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "org_accounting_config_upsert" ON org_accounting_config;
CREATE POLICY "org_accounting_config_upsert" ON org_accounting_config
  FOR INSERT TO authenticated
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "org_accounting_config_update" ON org_accounting_config;
CREATE POLICY "org_accounting_config_update" ON org_accounting_config
  FOR UPDATE TO authenticated
  USING (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'))
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "hedge_designations_select" ON hedge_designations;
CREATE POLICY "hedge_designations_select" ON hedge_designations
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "hedge_designations_write" ON hedge_designations;
CREATE POLICY "hedge_designations_write" ON hedge_designations
  FOR INSERT TO authenticated
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "hedge_designations_update" ON hedge_designations;
CREATE POLICY "hedge_designations_update" ON hedge_designations
  FOR UPDATE TO authenticated
  USING (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'))
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "hedged_items_select" ON hedged_items;
CREATE POLICY "hedged_items_select" ON hedged_items
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "hedged_items_write" ON hedged_items;
CREATE POLICY "hedged_items_write" ON hedged_items
  FOR INSERT TO authenticated
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "hedged_items_update" ON hedged_items;
CREATE POLICY "hedged_items_update" ON hedged_items
  FOR UPDATE TO authenticated
  USING (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'))
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "accounting_periods_select" ON accounting_periods;
CREATE POLICY "accounting_periods_select" ON accounting_periods
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "accounting_periods_write" ON accounting_periods;
CREATE POLICY "accounting_periods_write" ON accounting_periods
  FOR INSERT TO authenticated
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS "accounting_periods_update" ON accounting_periods;
CREATE POLICY "accounting_periods_update" ON accounting_periods
  FOR UPDATE TO authenticated
  USING (org_id = current_user_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_user_org_id() AND current_user_role() = 'admin');

-- Append-only RLS for measurements and ledgers.
ALTER TABLE fair_value_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE effectiveness_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE aoci_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivative_accounting_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fair_value_measurements_select" ON fair_value_measurements;
CREATE POLICY "fair_value_measurements_select" ON fair_value_measurements
  FOR SELECT USING (org_id = current_user_org_id());
DROP POLICY IF EXISTS "fair_value_measurements_insert_blocked" ON fair_value_measurements;
CREATE POLICY "fair_value_measurements_insert_blocked" ON fair_value_measurements
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "fair_value_measurements_update_blocked" ON fair_value_measurements;
CREATE POLICY "fair_value_measurements_update_blocked" ON fair_value_measurements
  FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "fair_value_measurements_delete_blocked" ON fair_value_measurements;
CREATE POLICY "fair_value_measurements_delete_blocked" ON fair_value_measurements
  FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "effectiveness_assessments_select" ON effectiveness_assessments;
CREATE POLICY "effectiveness_assessments_select" ON effectiveness_assessments
  FOR SELECT USING (org_id = current_user_org_id());
DROP POLICY IF EXISTS "effectiveness_assessments_insert_blocked" ON effectiveness_assessments;
CREATE POLICY "effectiveness_assessments_insert_blocked" ON effectiveness_assessments
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "effectiveness_assessments_update_blocked" ON effectiveness_assessments;
CREATE POLICY "effectiveness_assessments_update_blocked" ON effectiveness_assessments
  FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "effectiveness_assessments_delete_blocked" ON effectiveness_assessments;
CREATE POLICY "effectiveness_assessments_delete_blocked" ON effectiveness_assessments
  FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "aoci_ledger_select" ON aoci_ledger;
CREATE POLICY "aoci_ledger_select" ON aoci_ledger
  FOR SELECT USING (org_id = current_user_org_id());
DROP POLICY IF EXISTS "aoci_ledger_insert_blocked" ON aoci_ledger;
CREATE POLICY "aoci_ledger_insert_blocked" ON aoci_ledger
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "aoci_ledger_update_blocked" ON aoci_ledger;
CREATE POLICY "aoci_ledger_update_blocked" ON aoci_ledger
  FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "aoci_ledger_delete_blocked" ON aoci_ledger;
CREATE POLICY "aoci_ledger_delete_blocked" ON aoci_ledger
  FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "derivative_accounting_ledger_select" ON derivative_accounting_ledger;
CREATE POLICY "derivative_accounting_ledger_select" ON derivative_accounting_ledger
  FOR SELECT USING (org_id = current_user_org_id());
DROP POLICY IF EXISTS "derivative_accounting_ledger_insert_blocked" ON derivative_accounting_ledger;
CREATE POLICY "derivative_accounting_ledger_insert_blocked" ON derivative_accounting_ledger
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "derivative_accounting_ledger_update_blocked" ON derivative_accounting_ledger;
CREATE POLICY "derivative_accounting_ledger_update_blocked" ON derivative_accounting_ledger
  FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "derivative_accounting_ledger_delete_blocked" ON derivative_accounting_ledger;
CREATE POLICY "derivative_accounting_ledger_delete_blocked" ON derivative_accounting_ledger
  FOR DELETE TO authenticated USING (false);

-- Mandatory audit coverage for mutable accounting business tables.
DROP TRIGGER IF EXISTS trg_audit_org_accounting_config ON org_accounting_config;
CREATE TRIGGER trg_audit_org_accounting_config
  AFTER INSERT OR UPDATE OR DELETE ON org_accounting_config
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_hedge_designations ON hedge_designations;
CREATE TRIGGER trg_audit_hedge_designations
  AFTER INSERT OR UPDATE OR DELETE ON hedge_designations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_hedged_items ON hedged_items;
CREATE TRIGGER trg_audit_hedged_items
  AFTER INSERT OR UPDATE OR DELETE ON hedged_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_accounting_periods ON accounting_periods;
CREATE TRIGGER trg_audit_accounting_periods
  AFTER INSERT OR UPDATE OR DELETE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_org_accounting_config_updated_at ON org_accounting_config;
CREATE TRIGGER trg_org_accounting_config_updated_at
  BEFORE UPDATE ON org_accounting_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_hedge_designations_updated_at ON hedge_designations;
CREATE TRIGGER trg_hedge_designations_updated_at
  BEFORE UPDATE ON hedge_designations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_hedged_items_updated_at ON hedged_items;
CREATE TRIGGER trg_hedged_items_updated_at
  BEFORE UPDATE ON hedged_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_accounting_periods_updated_at ON accounting_periods;
CREATE TRIGGER trg_accounting_periods_updated_at
  BEFORE UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Structured designation persistence. The booking path can call this to create
-- preparatory records; final designation still requires complete inception docs.
CREATE OR REPLACE FUNCTION record_designation(
  p_position_id           UUID,
  p_designation_type      TEXT,
  p_hedged_risk           TEXT DEFAULT 'fx_spot',
  p_method                TEXT DEFAULT NULL,
  p_assessment_method     TEXT DEFAULT NULL,
  p_inception_doc         TEXT DEFAULT NULL,
  p_inception_doc_status  TEXT DEFAULT 'missing',
  p_functional_currency   TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_config org_accounting_config%ROWTYPE;
  v_position hedge_positions%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Admin or editor role required to record hedge designations';
  END IF;

  SELECT * INTO v_position
  FROM hedge_positions
  WHERE id = p_position_id AND org_id = v_org;

  IF v_position.id IS NULL THEN
    RAISE EXCEPTION 'Position % not found in caller organization', p_position_id;
  END IF;

  SELECT * INTO v_config FROM org_accounting_config WHERE org_id = v_org;
  IF v_config.id IS NULL THEN
    INSERT INTO org_accounting_config (org_id, updated_by)
    VALUES (v_org, auth.uid())
    RETURNING * INTO v_config;
  END IF;

  INSERT INTO hedge_designations (
    org_id, position_id, designation_type, framework, accounting_status,
    inception_doc_status, hedged_risk, method, assessment_method,
    inception_doc, probability_status, functional_currency, created_by
  ) VALUES (
    v_org, p_position_id, p_designation_type, v_config.framework, 'preparatory',
    p_inception_doc_status, p_hedged_risk, COALESCE(p_method, v_config.designation_method),
    COALESCE(p_assessment_method, v_config.effectiveness_method), p_inception_doc,
    'probable', p_functional_currency, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_fair_value_measurement(
  p_designation_id        UUID,
  p_period                TEXT,
  p_fair_value_usd        NUMERIC,
  p_source                TEXT,
  p_fair_value_hierarchy  TEXT,
  p_valuation_provider    TEXT DEFAULT NULL,
  p_source_document_ref   TEXT DEFAULT NULL,
  p_spot                  NUMERIC DEFAULT NULL,
  p_forward_rate          NUMERIC DEFAULT NULL,
  p_inputs                JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append fair value measurements';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO fair_value_measurements (
    org_id, designation_id, period, fair_value_usd, source, fair_value_hierarchy,
    valuation_provider, source_document_ref, spot, forward_rate, inputs
  ) VALUES (
    v_org, p_designation_id, p_period, p_fair_value_usd, p_source, p_fair_value_hierarchy,
    p_valuation_provider, p_source_document_ref, p_spot, p_forward_rate, COALESCE(p_inputs, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_effectiveness_assessment(
  p_designation_id              UUID,
  p_period                      TEXT,
  p_framework                   TEXT,
  p_method                      TEXT,
  p_verdict                     TEXT,
  p_rationale                   TEXT,
  p_actual_derivative_fv        NUMERIC DEFAULT NULL,
  p_hypothetical_derivative_fv  NUMERIC DEFAULT NULL,
  p_dollar_offset_ratio         NUMERIC DEFAULT NULL,
  p_regression_r2               NUMERIC DEFAULT NULL,
  p_regression_slope            NUMERIC DEFAULT NULL,
  p_ifrs9_economic_relationship BOOLEAN DEFAULT NULL,
  p_ifrs9_hedge_ratio           TEXT DEFAULT NULL,
  p_credit_risk_dominates       BOOLEAN DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append effectiveness assessments';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO effectiveness_assessments (
    org_id, designation_id, period, framework, method, actual_derivative_fv,
    hypothetical_derivative_fv, dollar_offset_ratio, regression_r2, regression_slope,
    ifrs9_economic_relationship, ifrs9_hedge_ratio, credit_risk_dominates,
    verdict, rationale
  ) VALUES (
    v_org, p_designation_id, p_period, p_framework, p_method, p_actual_derivative_fv,
    p_hypothetical_derivative_fv, p_dollar_offset_ratio, p_regression_r2, p_regression_slope,
    p_ifrs9_economic_relationship, p_ifrs9_hedge_ratio, p_credit_risk_dominates,
    p_verdict, p_rationale
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_aoci_ledger_entry(
  p_designation_id     UUID,
  p_hedged_item_id     UUID,
  p_period             TEXT,
  p_event_type         TEXT,
  p_bucket             TEXT,
  p_amount_usd         NUMERIC,
  p_balance_after_usd  NUMERIC,
  p_source_event_ref   TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_item_org UUID;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append AOCI ledger entries';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  IF p_hedged_item_id IS NOT NULL THEN
    SELECT org_id INTO v_item_org
    FROM hedged_items
    WHERE id = p_hedged_item_id AND designation_id = p_designation_id;

    IF v_item_org IS NULL OR v_item_org <> v_org THEN
      RAISE EXCEPTION 'Hedged item % is not part of designation %', p_hedged_item_id, p_designation_id;
    END IF;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO aoci_ledger (
    org_id, designation_id, hedged_item_id, period, event_type, bucket,
    amount_usd, balance_after_usd, source_event_ref
  ) VALUES (
    v_org, p_designation_id, p_hedged_item_id, p_period, p_event_type,
    COALESCE(p_bucket, 'aoci_cf'), p_amount_usd, p_balance_after_usd, p_source_event_ref
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION append_derivative_accounting_entry(
  p_designation_id                    UUID,
  p_position_id                       UUID,
  p_draw_id                           UUID,
  p_period                            TEXT,
  p_event_type                        TEXT,
  p_amount_usd                        NUMERIC,
  p_derivative_balance_after_usd      NUMERIC,
  p_fair_value_measurement_id         UUID DEFAULT NULL,
  p_source_event_ref                  TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_designation hedge_designations%ROWTYPE;
  v_position_org UUID;
  v_draw_org UUID;
  v_fv_org UUID;
  v_id UUID;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to append derivative accounting entries';
  END IF;

  SELECT * INTO v_designation
  FROM hedge_designations
  WHERE id = p_designation_id AND org_id = v_org;

  IF v_designation.id IS NULL THEN
    RAISE EXCEPTION 'Designation % not found in caller organization', p_designation_id;
  END IF;

  SELECT org_id INTO v_position_org
  FROM hedge_positions
  WHERE id = p_position_id;

  IF v_position_org IS NULL OR v_position_org <> v_org OR v_designation.position_id <> p_position_id THEN
    RAISE EXCEPTION 'Position % is not the designated instrument', p_position_id;
  END IF;

  IF p_draw_id IS NOT NULL THEN
    SELECT org_id INTO v_draw_org
    FROM hedge_position_draws
    WHERE id = p_draw_id AND position_id = p_position_id;

    IF v_draw_org IS NULL OR v_draw_org <> v_org THEN
      RAISE EXCEPTION 'Draw % is not part of position %', p_draw_id, p_position_id;
    END IF;
  END IF;

  IF p_fair_value_measurement_id IS NOT NULL THEN
    SELECT org_id INTO v_fv_org
    FROM fair_value_measurements
    WHERE id = p_fair_value_measurement_id AND designation_id = p_designation_id;

    IF v_fv_org IS NULL OR v_fv_org <> v_org THEN
      RAISE EXCEPTION 'Fair value measurement % is not part of designation %',
        p_fair_value_measurement_id, p_designation_id;
    END IF;
  END IF;

  PERFORM assert_accounting_period_writable(v_org, p_period);

  INSERT INTO derivative_accounting_ledger (
    org_id, designation_id, position_id, draw_id, period, event_type,
    amount_usd, derivative_balance_after_usd, fair_value_measurement_id,
    source_event_ref
  ) VALUES (
    v_org, p_designation_id, p_position_id, p_draw_id, p_period, p_event_type,
    p_amount_usd, p_derivative_balance_after_usd, p_fair_value_measurement_id,
    p_source_event_ref
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION set_accounting_period_status(
  p_period TEXT,
  p_status TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := current_user_org_id();
  v_id UUID;
  v_current_status TEXT;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required to change accounting periods';
  END IF;
  IF p_status NOT IN ('open','closed','locked') THEN
    RAISE EXCEPTION 'Unsupported accounting period status %', p_status;
  END IF;
  IF p_status = 'locked' THEN
    PERFORM assert_final_journal_allowed(v_org, p_period);
  END IF;

  SELECT id, status INTO v_id, v_current_status
  FROM accounting_periods
  WHERE org_id = v_org AND period = p_period;

  IF v_current_status = 'locked' THEN
    IF p_status = 'locked' THEN
      RETURN v_id;
    END IF;
    RAISE EXCEPTION 'Accounting period % is locked', p_period;
  END IF;

  INSERT INTO accounting_periods (
    org_id, period, status, closed_at, closed_by, locked_at, locked_by
  ) VALUES (
    v_org, p_period, p_status,
    CASE WHEN p_status IN ('closed','locked') THEN NOW() ELSE NULL END,
    CASE WHEN p_status IN ('closed','locked') THEN auth.uid() ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'locked' THEN auth.uid() ELSE NULL END
  )
  ON CONFLICT (org_id, period) DO UPDATE SET
    status = EXCLUDED.status,
    closed_at = EXCLUDED.closed_at,
    closed_by = EXCLUDED.closed_by,
    locked_at = EXCLUDED.locked_at,
    locked_by = EXCLUDED.locked_by
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION record_designation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION append_fair_value_measurement(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION append_effectiveness_assessment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION append_aoci_ledger_entry(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION append_derivative_accounting_entry(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_accounting_period_status(TEXT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION record_designation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION append_fair_value_measurement(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION append_effectiveness_assessment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION append_aoci_ledger_entry(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION append_derivative_accounting_entry(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION set_accounting_period_status(TEXT, TEXT)
  TO authenticated;
