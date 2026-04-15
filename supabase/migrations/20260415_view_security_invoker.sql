-- ============================================================
-- ORBIT: View Security Invoker Enforcement
-- Forces PostgreSQL views to execute with the privileges of the caller (invoker)
-- rather than the creator, guaranteeing that underlying RLS policies are applied.
-- ============================================================

ALTER VIEW v_exposure_summary SET (security_invoker = on);
ALTER VIEW v_hedge_coverage SET (security_invoker = on);
