-- ============================================================
-- Hedge Lifecycle: Roll / Amend / Early Close
-- ============================================================
-- Adds columns and status values to support trade lifecycle
-- operations: rolling positions forward, amending terms, and
-- early closing with realized P&L tracking.
-- ============================================================

-- 1. Expand status CHECK to include 'rolled' and 'closed'
ALTER TABLE hedge_positions DROP CONSTRAINT IF EXISTS hedge_positions_status_check;
ALTER TABLE hedge_positions ADD CONSTRAINT hedge_positions_status_check
  CHECK (status IN ('active', 'expired', 'cancelled', 'rolled', 'closed'));

-- 2. Roll chain: link new position to the one it replaced
ALTER TABLE hedge_positions ADD COLUMN IF NOT EXISTS rolled_from_id UUID REFERENCES hedge_positions(id);

-- 3. Early close tracking
ALTER TABLE hedge_positions ADD COLUMN IF NOT EXISTS close_date DATE;
ALTER TABLE hedge_positions ADD COLUMN IF NOT EXISTS close_rate NUMERIC(20, 8);

-- 4. Amendment tracking
ALTER TABLE hedge_positions ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ;

-- 5. Index for roll chain lookups
CREATE INDEX IF NOT EXISTS idx_hedge_positions_rolled_from
  ON hedge_positions(rolled_from_id) WHERE rolled_from_id IS NOT NULL;
