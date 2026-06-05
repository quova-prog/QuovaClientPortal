-- ============================================================
-- Window Forwards — Phase 1 Migration A
-- Extend hedge_positions to support window_forward as a first-class
-- instrument. Idempotent: coexists with 20260330_hedge_policy_v2.sql
-- and 20260411_hedge_lifecycle.sql.
-- ============================================================

-- 1. Allow the new instrument type.
ALTER TABLE hedge_positions
  DROP CONSTRAINT IF EXISTS hedge_positions_instrument_type_check;
ALTER TABLE hedge_positions
  ADD CONSTRAINT hedge_positions_instrument_type_check
  CHECK (instrument_type IN ('forward', 'window_forward', 'swap', 'option', 'spot'));

-- 2. Window-specific columns (nullable for non-window instruments).
ALTER TABLE hedge_positions
  ADD COLUMN IF NOT EXISTS window_start_date DATE,
  ADD COLUMN IF NOT EXISTS window_end_date   DATE,
  ADD COLUMN IF NOT EXISTS pricing_method    TEXT,
  ADD COLUMN IF NOT EXISTS drawn_notional    NUMERIC(20,2) NOT NULL DEFAULT 0;

-- 3. Window fields are present iff the instrument is a window forward,
--    and pricing_method must be a known variant.
DO $$ BEGIN
  ALTER TABLE hedge_positions ADD CONSTRAINT window_dates_consistent CHECK (
    (instrument_type = 'window_forward'
       AND window_start_date IS NOT NULL
       AND window_end_date   IS NOT NULL
       AND window_end_date >= window_start_date
       AND pricing_method  IN ('fixed_worst_rate','pro_rata_points'))
    OR (instrument_type <> 'window_forward'
       AND window_start_date IS NULL
       AND window_end_date   IS NULL
       AND pricing_method    IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. drawn_notional is trigger-maintained (Migration B) and bounded.
DO $$ BEGIN
  ALTER TABLE hedge_positions ADD CONSTRAINT drawn_notional_bounded
    CHECK (drawn_notional >= 0 AND drawn_notional <= notional_base);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
