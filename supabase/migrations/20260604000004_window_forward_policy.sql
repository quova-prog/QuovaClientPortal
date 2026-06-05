-- ============================================================
-- Window Forwards — Phase 1 Migration D
-- Policy controls for window forwards. allowed_instruments already
-- exists (nullable) from 20260330_hedge_policy_v2.sql, so this only adds
-- the missing columns, backfills carefully, and adds hedge_policies to
-- the mandatory audit trigger (the allowlist is compliance-sensitive).
-- ============================================================

ALTER TABLE hedge_policies
  ADD COLUMN IF NOT EXISTS window_forward_pairs TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS max_window_days      INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS max_draws_per_window INTEGER NOT NULL DEFAULT 8;

DO $$ BEGIN
  ALTER TABLE hedge_policies ADD CONSTRAINT chk_hp_max_window_days
    CHECK (max_window_days > 0 AND max_window_days <= 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE hedge_policies ADD CONSTRAINT chk_hp_max_draws
    CHECK (max_draws_per_window > 0 AND max_draws_per_window <= 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill NULL allowed_instruments with the classic four. Window forwards
-- are explicit opt-in and are NEVER enabled by migration.
UPDATE hedge_policies
  SET allowed_instruments = ARRAY['forward','swap','option','spot']::TEXT[]
  WHERE allowed_instruments IS NULL;

-- Audit policy changes (no separate policy_versions table exists; the
-- mandatory audit trigger is the version history).
DROP TRIGGER IF EXISTS trg_audit_hedge_policies ON hedge_policies;
CREATE TRIGGER trg_audit_hedge_policies
  AFTER INSERT OR UPDATE OR DELETE ON hedge_policies
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
