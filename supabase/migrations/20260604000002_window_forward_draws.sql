-- ============================================================
-- Window Forwards — Phase 1 Migration B
-- Draw ledger with write-once economics, org-match + recalc/auto-close
-- triggers (concurrency-safe via parent FOR UPDATE lock), mandatory
-- audit coverage, and RLS that makes the Phase-2 RPC the only write path.
-- ============================================================

CREATE TABLE IF NOT EXISTS hedge_position_draws (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id         UUID NOT NULL REFERENCES hedge_positions(id) ON DELETE CASCADE,
  draw_seq            INTEGER NOT NULL,
  draw_date           DATE    NOT NULL,
  draw_amount         NUMERIC(20,2) NOT NULL CHECK (draw_amount > 0),
  draw_rate           NUMERIC(20,8) NOT NULL,
  spot_rate_at_draw   NUMERIC(20,8) NOT NULL,
  settlement_quote    NUMERIC(20,2) NOT NULL,
  realized_pnl_quote  NUMERIC(20,2) NOT NULL,
  realized_pnl_usd    NUMERIC(20,2) NOT NULL,
  is_final_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  bank_confirmation   TEXT,
  reference_number    TEXT,
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_draw_seq  ON hedge_position_draws(position_id, draw_seq);
CREATE INDEX IF NOT EXISTS idx_draws_position  ON hedge_position_draws(position_id);
CREATE INDEX IF NOT EXISTS idx_draws_org_date  ON hedge_position_draws(org_id, draw_date);

-- Org-match: a draw's org must equal its parent position's org.
CREATE OR REPLACE FUNCTION enforce_draw_org_matches_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pos_org UUID;
BEGIN
  SELECT org_id INTO v_pos_org FROM hedge_positions WHERE id = NEW.position_id;
  IF v_pos_org IS NULL THEN
    RAISE EXCEPTION 'hedge_position_draws: parent position % not found', NEW.position_id;
  END IF;
  IF NEW.org_id <> v_pos_org THEN
    RAISE EXCEPTION 'hedge_position_draws: org_id % does not match position org %',
      NEW.org_id, v_pos_org;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_draw_org_match ON hedge_position_draws;
CREATE TRIGGER trg_draw_org_match
  BEFORE INSERT OR UPDATE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION enforce_draw_org_matches_position();

-- Recalc drawn_notional + auto-close. Parent FOR UPDATE lock serializes
-- concurrent draws so the notional/close invariant holds under load.
CREATE OR REPLACE FUNCTION recalc_drawn_notional()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC(20,2); v_notional NUMERIC(20,2); v_pos UUID;
BEGIN
  v_pos := COALESCE(NEW.position_id, OLD.position_id);
  SELECT notional_base INTO v_notional FROM hedge_positions WHERE id = v_pos FOR UPDATE;
  SELECT COALESCE(SUM(draw_amount),0) INTO v_total
    FROM hedge_position_draws WHERE position_id = v_pos;
  UPDATE hedge_positions
    SET drawn_notional = v_total,
        status = CASE WHEN v_total >= v_notional THEN 'closed' ELSE status END,
        updated_at = NOW()
    WHERE id = v_pos;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_draws_recalc_notional ON hedge_position_draws;
CREATE TRIGGER trg_draws_recalc_notional
  AFTER INSERT OR UPDATE OR DELETE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION recalc_drawn_notional();

-- Mandatory audit (session-14 pattern).
DROP TRIGGER IF EXISTS trg_audit_hedge_position_draws ON hedge_position_draws;
CREATE TRIGGER trg_audit_hedge_position_draws
  AFTER INSERT OR UPDATE OR DELETE ON hedge_position_draws
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- RLS: org-scoped read; all direct writes blocked. The Phase-2
-- record_window_draw() RPC is SECURITY DEFINER and bypasses RLS, so it
-- remains the single write path.
ALTER TABLE hedge_position_draws ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "draws_select_org" ON hedge_position_draws;
CREATE POLICY "draws_select_org" ON hedge_position_draws
  FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "draws_no_direct_insert" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_insert" ON hedge_position_draws
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "draws_no_direct_update" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_update" ON hedge_position_draws
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "draws_no_direct_delete" ON hedge_position_draws;
CREATE POLICY "draws_no_direct_delete" ON hedge_position_draws
  FOR DELETE TO authenticated USING (false);
