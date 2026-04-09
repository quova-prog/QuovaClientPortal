-- ── Hedge Policy v2: entity-level policies + new config columns ────────────
-- Extends the existing hedge_policies table with per-entity support and
-- additional fields required by the Strategy workbench page.

ALTER TABLE hedge_policies
  ADD COLUMN IF NOT EXISTS entity_id               UUID        REFERENCES entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_hedge_ratio_pct  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS max_tenor_months        INTEGER,
  ADD COLUMN IF NOT EXISTS allowed_instruments     TEXT[],
  ADD COLUMN IF NOT EXISTS rebalance_frequency     TEXT        NOT NULL DEFAULT 'quarterly',
  ADD COLUMN IF NOT EXISTS coverage_horizon_months INTEGER     NOT NULL DEFAULT 6;

-- Rebalance frequency check
DO $$ BEGIN
  ALTER TABLE hedge_policies
    ADD CONSTRAINT chk_hp_rebalance_frequency
    CHECK (rebalance_frequency IN ('monthly', 'quarterly', 'on_trigger'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fast lookup: org + entity
CREATE INDEX IF NOT EXISTS idx_hedge_policies_org_entity
  ON hedge_policies(org_id, entity_id);
