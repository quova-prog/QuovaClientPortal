-- ============================================================
-- Add entity_id FK to upload data tables
-- ============================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE revenue_forecasts
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE cash_flows
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE budget_rates
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE loan_schedules
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE intercompany_transfers
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE capex
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE supplier_contracts
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE customer_contracts
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

ALTER TABLE upload_batches
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

-- Indexes for entity-scoped queries
CREATE INDEX IF NOT EXISTS idx_purchase_orders_entity     ON purchase_orders(entity_id);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_entity   ON revenue_forecasts(entity_id);
CREATE INDEX IF NOT EXISTS idx_cash_flows_entity          ON cash_flows(entity_id);
CREATE INDEX IF NOT EXISTS idx_budget_rates_entity        ON budget_rates(entity_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedules_entity      ON loan_schedules(entity_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entity             ON payroll(entity_id);
CREATE INDEX IF NOT EXISTS idx_intercompany_entity        ON intercompany_transfers(entity_id);
CREATE INDEX IF NOT EXISTS idx_capex_entity               ON capex(entity_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_entity  ON supplier_contracts(entity_id);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_entity  ON customer_contracts(entity_id);
CREATE INDEX IF NOT EXISTS idx_upload_batches_entity      ON upload_batches(entity_id);
