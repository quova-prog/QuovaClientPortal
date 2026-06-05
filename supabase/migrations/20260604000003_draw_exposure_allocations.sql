-- ============================================================
-- Window Forwards — Phase 1 Migration C
-- Link draws to the underlying exposures they settle so coverage and
-- exposure fall together. Adds fx_exposures.settled_amount and a
-- draw_exposure_allocations table (allocate a draw to a DB exposure row
-- OR a derived-source reference, never both).
-- ============================================================

ALTER TABLE fx_exposures
  ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(20,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE fx_exposures ADD CONSTRAINT fx_exposures_settled_bounded
    CHECK (settled_amount >= 0 AND settled_amount <= notional_base);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS draw_exposure_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  draw_id          UUID NOT NULL REFERENCES hedge_position_draws(id) ON DELETE CASCADE,
  exposure_id      UUID REFERENCES fx_exposures(id) ON DELETE SET NULL,
  derived_source   TEXT,
  derived_ref      TEXT,
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_target CHECK (
    (exposure_id IS NOT NULL AND derived_source IS NULL)
    OR (exposure_id IS NULL AND derived_source IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_alloc_draw     ON draw_exposure_allocations(draw_id);
CREATE INDEX IF NOT EXISTS idx_alloc_exposure ON draw_exposure_allocations(exposure_id);

DROP TRIGGER IF EXISTS trg_audit_draw_exposure_allocations ON draw_exposure_allocations;
CREATE TRIGGER trg_audit_draw_exposure_allocations
  AFTER INSERT OR UPDATE OR DELETE ON draw_exposure_allocations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

ALTER TABLE draw_exposure_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alloc_select_org" ON draw_exposure_allocations;
CREATE POLICY "alloc_select_org" ON draw_exposure_allocations
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "alloc_no_direct_insert" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_insert" ON draw_exposure_allocations
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "alloc_no_direct_update" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_update" ON draw_exposure_allocations
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "alloc_no_direct_delete" ON draw_exposure_allocations;
CREATE POLICY "alloc_no_direct_delete" ON draw_exposure_allocations
  FOR DELETE TO authenticated USING (false);
