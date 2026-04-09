-- Add hedge_type to hedge_positions for ASC 815 hedge accounting classification
-- Defaults to 'cash_flow' (most common for FX forwards)

ALTER TABLE hedge_positions
  ADD COLUMN IF NOT EXISTS hedge_type TEXT NOT NULL DEFAULT 'cash_flow';

DO $$ BEGIN
  ALTER TABLE hedge_positions
    ADD CONSTRAINT chk_hp_hedge_type
    CHECK (hedge_type IN ('cash_flow', 'fair_value', 'net_investment'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_hedge_positions_hedge_type
  ON hedge_positions(org_id, hedge_type);
