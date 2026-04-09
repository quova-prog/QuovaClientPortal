-- ============================================================
-- ORBIT: Role-enforced RLS (SOC2 CC6.3)
-- Viewers (role = 'viewer') may only SELECT on sensitive tables.
-- ============================================================

-- Helper: returns the role of the currently authenticated user
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ── hedge_positions ──────────────────────────────────────────
DROP POLICY IF EXISTS "hedge_positions_insert" ON hedge_positions;
CREATE POLICY "hedge_positions_insert" ON hedge_positions
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "hedge_positions_update" ON hedge_positions;
CREATE POLICY "hedge_positions_update" ON hedge_positions
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "hedge_positions_delete" ON hedge_positions;
CREATE POLICY "hedge_positions_delete" ON hedge_positions
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── fx_exposures ─────────────────────────────────────────────
DROP POLICY IF EXISTS "fx_exposures_insert" ON fx_exposures;
CREATE POLICY "fx_exposures_insert" ON fx_exposures
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "fx_exposures_update" ON fx_exposures;
CREATE POLICY "fx_exposures_update" ON fx_exposures
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "fx_exposures_delete" ON fx_exposures;
CREATE POLICY "fx_exposures_delete" ON fx_exposures
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── cash_flows ───────────────────────────────────────────────
DROP POLICY IF EXISTS "cash_flows_insert" ON cash_flows;
CREATE POLICY "cash_flows_insert" ON cash_flows
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "cash_flows_update" ON cash_flows;
CREATE POLICY "cash_flows_update" ON cash_flows
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "cash_flows_delete" ON cash_flows;
CREATE POLICY "cash_flows_delete" ON cash_flows
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── purchase_orders ──────────────────────────────────────────
DROP POLICY IF EXISTS "purchase_orders_insert" ON purchase_orders;
CREATE POLICY "purchase_orders_insert" ON purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "purchase_orders_update" ON purchase_orders;
CREATE POLICY "purchase_orders_update" ON purchase_orders
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "purchase_orders_delete" ON purchase_orders;
CREATE POLICY "purchase_orders_delete" ON purchase_orders
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── budget_rates ─────────────────────────────────────────────
DROP POLICY IF EXISTS "budget_rates_insert" ON budget_rates;
CREATE POLICY "budget_rates_insert" ON budget_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "budget_rates_update" ON budget_rates;
CREATE POLICY "budget_rates_update" ON budget_rates
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "budget_rates_delete" ON budget_rates;
CREATE POLICY "budget_rates_delete" ON budget_rates
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── revenue_forecasts ────────────────────────────────────────
DROP POLICY IF EXISTS "revenue_forecasts_insert" ON revenue_forecasts;
CREATE POLICY "revenue_forecasts_insert" ON revenue_forecasts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "revenue_forecasts_update" ON revenue_forecasts;
CREATE POLICY "revenue_forecasts_update" ON revenue_forecasts
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "revenue_forecasts_delete" ON revenue_forecasts;
CREATE POLICY "revenue_forecasts_delete" ON revenue_forecasts
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── loan_schedules ───────────────────────────────────────────
DROP POLICY IF EXISTS "loan_schedules_insert" ON loan_schedules;
CREATE POLICY "loan_schedules_insert" ON loan_schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "loan_schedules_update" ON loan_schedules;
CREATE POLICY "loan_schedules_update" ON loan_schedules
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "loan_schedules_delete" ON loan_schedules;
CREATE POLICY "loan_schedules_delete" ON loan_schedules
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── payroll ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "payroll_insert" ON payroll;
CREATE POLICY "payroll_insert" ON payroll
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "payroll_update" ON payroll;
CREATE POLICY "payroll_update" ON payroll
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "payroll_delete" ON payroll;
CREATE POLICY "payroll_delete" ON payroll
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── capex ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "capex_insert" ON capex;
CREATE POLICY "capex_insert" ON capex
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "capex_update" ON capex;
CREATE POLICY "capex_update" ON capex
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "capex_delete" ON capex;
CREATE POLICY "capex_delete" ON capex
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── intercompany_transfers ───────────────────────────────────
DROP POLICY IF EXISTS "intercompany_transfers_insert" ON intercompany_transfers;
CREATE POLICY "intercompany_transfers_insert" ON intercompany_transfers
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "intercompany_transfers_update" ON intercompany_transfers;
CREATE POLICY "intercompany_transfers_update" ON intercompany_transfers
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "intercompany_transfers_delete" ON intercompany_transfers;
CREATE POLICY "intercompany_transfers_delete" ON intercompany_transfers
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── supplier_contracts ───────────────────────────────────────
DROP POLICY IF EXISTS "supplier_contracts_insert" ON supplier_contracts;
CREATE POLICY "supplier_contracts_insert" ON supplier_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "supplier_contracts_update" ON supplier_contracts;
CREATE POLICY "supplier_contracts_update" ON supplier_contracts
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "supplier_contracts_delete" ON supplier_contracts;
CREATE POLICY "supplier_contracts_delete" ON supplier_contracts
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

-- ── customer_contracts ───────────────────────────────────────
DROP POLICY IF EXISTS "customer_contracts_insert" ON customer_contracts;
CREATE POLICY "customer_contracts_insert" ON customer_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "customer_contracts_update" ON customer_contracts;
CREATE POLICY "customer_contracts_update" ON customer_contracts
  FOR UPDATE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "customer_contracts_delete" ON customer_contracts;
CREATE POLICY "customer_contracts_delete" ON customer_contracts
  FOR DELETE USING (
    org_id = current_user_org_id()
    AND current_user_role() IN ('admin', 'editor')
  );
