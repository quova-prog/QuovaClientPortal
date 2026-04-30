-- ============================================================
-- ORBIT: SOC2 Commodity Audit Triggers
-- Enforces server-side audit logging for the new commodity tables.
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_commodity_exposures ON commodity_exposures;
CREATE TRIGGER trg_audit_commodity_exposures
  AFTER INSERT OR UPDATE OR DELETE ON commodity_exposures
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS trg_audit_commodity_hedges ON commodity_hedges;
CREATE TRIGGER trg_audit_commodity_hedges
  AFTER INSERT OR UPDATE OR DELETE ON commodity_hedges
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
