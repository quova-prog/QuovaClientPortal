-- ============================================================
-- ORBIT MVP — Upload Deduplication
-- Migration 006: Add file_hash + table_name to upload_batches,
--                unique constraints on data tables
-- ============================================================

-- ── Extend upload_batches ─────────────────────────────────────

ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS file_hash TEXT;
ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS table_name TEXT;

-- One hash per org per table (prevents duplicate file uploads)
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_batches_hash
  ON upload_batches(org_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- ── Record-level unique constraints ───────────────────────────

ALTER TABLE budget_rates ADD CONSTRAINT uq_budget_rates
  UNIQUE (org_id, currency_pair, fiscal_year, period);

ALTER TABLE purchase_orders ADD CONSTRAINT uq_purchase_orders
  UNIQUE (org_id, po_number);

ALTER TABLE loan_schedules ADD CONSTRAINT uq_loan_schedules
  UNIQUE (org_id, loan_id);

ALTER TABLE payroll ADD CONSTRAINT uq_payroll
  UNIQUE (org_id, pay_date, entity, currency);

ALTER TABLE capex ADD CONSTRAINT uq_capex
  UNIQUE (org_id, project_name);

ALTER TABLE supplier_contracts ADD CONSTRAINT uq_supplier_contracts
  UNIQUE (org_id, supplier_name, start_date);

ALTER TABLE customer_contracts ADD CONSTRAINT uq_customer_contracts
  UNIQUE (org_id, customer_name, start_date);

-- revenue_forecasts: unique per currency+period+fiscal_year+segment+region
ALTER TABLE revenue_forecasts ADD CONSTRAINT uq_revenue_forecasts
  UNIQUE (org_id, currency, fiscal_year, period, segment, region);

-- intercompany: unique per reference (when not null/empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_intercompany_reference
  ON intercompany_transfers(org_id, reference)
  WHERE reference IS NOT NULL AND reference != '';

-- Note: cash_flows has no natural unique key — file hash is the only dedup
