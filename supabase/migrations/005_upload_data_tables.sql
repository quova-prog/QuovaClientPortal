-- ============================================================
-- ORBIT MVP — Upload Data Tables
-- Migration 005: budget_rates, revenue_forecasts, purchase_orders,
--                cash_flows, loan_schedules, payroll,
--                intercompany_transfers, capex,
--                supplier_contracts, customer_contracts
-- ============================================================

-- ── BUDGET RATES ─────────────────────────────────────────────

CREATE TABLE budget_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by     UUID REFERENCES profiles(id),
  currency_pair   TEXT NOT NULL,
  budget_rate     NUMERIC(20,8) NOT NULL,
  fiscal_year     INTEGER NOT NULL,
  period          TEXT NOT NULL,
  notional_budget NUMERIC(20,2) NOT NULL DEFAULT 0,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE budget_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_rates_insert" ON budget_rates
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "budget_rates_select" ON budget_rates
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "budget_rates_update" ON budget_rates
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "budget_rates_delete" ON budget_rates
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_budget_rates_org        ON budget_rates(org_id);
CREATE INDEX idx_budget_rates_org_fy     ON budget_rates(org_id, fiscal_year);
CREATE INDEX idx_budget_rates_pair       ON budget_rates(org_id, currency_pair);

-- ── REVENUE FORECASTS ─────────────────────────────────────────

CREATE TABLE revenue_forecasts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES profiles(id),
  currency     TEXT NOT NULL,
  amount       NUMERIC(20,2) NOT NULL,
  period       TEXT NOT NULL,
  fiscal_year  INTEGER NOT NULL,
  segment      TEXT,
  region       TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE revenue_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revenue_forecasts_insert" ON revenue_forecasts
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "revenue_forecasts_select" ON revenue_forecasts
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "revenue_forecasts_update" ON revenue_forecasts
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "revenue_forecasts_delete" ON revenue_forecasts
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_revenue_forecasts_org    ON revenue_forecasts(org_id);
CREATE INDEX idx_revenue_forecasts_org_fy ON revenue_forecasts(org_id, fiscal_year);
CREATE INDEX idx_revenue_forecasts_period ON revenue_forecasts(org_id, period);

-- ── PURCHASE ORDERS ───────────────────────────────────────────

CREATE TABLE purchase_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES profiles(id),
  po_number    TEXT NOT NULL,
  supplier     TEXT NOT NULL,
  currency     TEXT NOT NULL,
  amount       NUMERIC(20,2) NOT NULL,
  due_date     DATE,
  issue_date   DATE,
  category     TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_orders_insert" ON purchase_orders
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "purchase_orders_select" ON purchase_orders
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "purchase_orders_update" ON purchase_orders
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "purchase_orders_delete" ON purchase_orders
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_purchase_orders_org        ON purchase_orders(org_id);
CREATE INDEX idx_purchase_orders_due_date   ON purchase_orders(org_id, due_date);
CREATE INDEX idx_purchase_orders_status     ON purchase_orders(org_id, status);

-- ── CASH FLOWS ────────────────────────────────────────────────

CREATE TABLE cash_flows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES profiles(id),
  flow_date    DATE NOT NULL,
  currency     TEXT NOT NULL,
  amount       NUMERIC(20,2) NOT NULL,
  flow_type    TEXT NOT NULL DEFAULT 'inflow',
  category     TEXT,
  entity       TEXT,
  account      TEXT,
  counterparty TEXT,
  description  TEXT,
  confidence   TEXT NOT NULL DEFAULT 'forecast',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cash_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_flows_insert" ON cash_flows
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "cash_flows_select" ON cash_flows
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "cash_flows_update" ON cash_flows
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "cash_flows_delete" ON cash_flows
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_cash_flows_org       ON cash_flows(org_id);
CREATE INDEX idx_cash_flows_date      ON cash_flows(org_id, flow_date);
CREATE INDEX idx_cash_flows_type      ON cash_flows(org_id, flow_type);

-- ── LOAN SCHEDULES ────────────────────────────────────────────

CREATE TABLE loan_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by         UUID REFERENCES profiles(id),
  loan_id             TEXT NOT NULL,
  lender              TEXT NOT NULL,
  currency            TEXT NOT NULL,
  principal           NUMERIC(20,2) NOT NULL,
  outstanding_balance NUMERIC(20,2) NOT NULL,
  interest_rate       NUMERIC(8,4) NOT NULL,
  payment_date        DATE,
  maturity_date       DATE,
  payment_type        TEXT,
  payment_amount      NUMERIC(20,2),
  loan_type           TEXT,
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE loan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loan_schedules_insert" ON loan_schedules
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "loan_schedules_select" ON loan_schedules
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "loan_schedules_update" ON loan_schedules
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "loan_schedules_delete" ON loan_schedules
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_loan_schedules_org          ON loan_schedules(org_id);
CREATE INDEX idx_loan_schedules_payment_date ON loan_schedules(org_id, payment_date);
CREATE INDEX idx_loan_schedules_maturity     ON loan_schedules(org_id, maturity_date);

-- ── PAYROLL ───────────────────────────────────────────────────

CREATE TABLE payroll (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by    UUID REFERENCES profiles(id),
  pay_date       DATE NOT NULL,
  currency       TEXT NOT NULL,
  gross_amount   NUMERIC(20,2) NOT NULL,
  net_amount     NUMERIC(20,2),
  employee_count INTEGER,
  entity         TEXT,
  department     TEXT,
  pay_period     TEXT,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_insert" ON payroll
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "payroll_select" ON payroll
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "payroll_update" ON payroll
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "payroll_delete" ON payroll
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_payroll_org      ON payroll(org_id);
CREATE INDEX idx_payroll_pay_date ON payroll(org_id, pay_date);
CREATE INDEX idx_payroll_entity   ON payroll(org_id, entity);

-- ── INTERCOMPANY TRANSFERS ────────────────────────────────────

CREATE TABLE intercompany_transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES profiles(id),
  transfer_date DATE NOT NULL,
  from_entity   TEXT NOT NULL,
  to_entity     TEXT NOT NULL,
  currency      TEXT NOT NULL,
  amount        NUMERIC(20,2) NOT NULL,
  transfer_type TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  reference     TEXT,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE intercompany_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompany_transfers_insert" ON intercompany_transfers
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "intercompany_transfers_select" ON intercompany_transfers
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "intercompany_transfers_update" ON intercompany_transfers
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "intercompany_transfers_delete" ON intercompany_transfers
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_intercompany_org           ON intercompany_transfers(org_id);
CREATE INDEX idx_intercompany_transfer_date ON intercompany_transfers(org_id, transfer_date);
CREATE INDEX idx_intercompany_status        ON intercompany_transfers(org_id, status);

-- ── CAPEX ─────────────────────────────────────────────────────

CREATE TABLE capex (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by      UUID REFERENCES profiles(id),
  project_name     TEXT NOT NULL,
  currency         TEXT NOT NULL,
  budget_amount    NUMERIC(20,2) NOT NULL,
  committed_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  payment_date     DATE,
  category         TEXT,
  entity           TEXT,
  status           TEXT NOT NULL DEFAULT 'planned',
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE capex ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capex_insert" ON capex
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "capex_select" ON capex
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "capex_update" ON capex
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "capex_delete" ON capex
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_capex_org          ON capex(org_id);
CREATE INDEX idx_capex_payment_date ON capex(org_id, payment_date);
CREATE INDEX idx_capex_status       ON capex(org_id, status);

-- ── SUPPLIER CONTRACTS ────────────────────────────────────────

CREATE TABLE supplier_contracts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by        UUID REFERENCES profiles(id),
  supplier_name      TEXT NOT NULL,
  currency           TEXT NOT NULL,
  contract_value     NUMERIC(20,2) NOT NULL,
  start_date         DATE,
  end_date           DATE,
  payment_frequency  TEXT,
  next_payment_date  DATE,
  payment_amount     NUMERIC(20,2),
  category           TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_contracts_insert" ON supplier_contracts
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "supplier_contracts_select" ON supplier_contracts
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "supplier_contracts_update" ON supplier_contracts
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "supplier_contracts_delete" ON supplier_contracts
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_supplier_contracts_org       ON supplier_contracts(org_id);
CREATE INDEX idx_supplier_contracts_end_date  ON supplier_contracts(org_id, end_date);
CREATE INDEX idx_supplier_contracts_status    ON supplier_contracts(org_id, status);

-- ── CUSTOMER CONTRACTS ────────────────────────────────────────

CREATE TABLE customer_contracts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by        UUID REFERENCES profiles(id),
  customer_name      TEXT NOT NULL,
  currency           TEXT NOT NULL,
  contract_value     NUMERIC(20,2) NOT NULL,
  start_date         DATE,
  end_date           DATE,
  payment_frequency  TEXT,
  next_payment_date  DATE,
  payment_amount     NUMERIC(20,2),
  segment            TEXT,
  region             TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_contracts_insert" ON customer_contracts
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "customer_contracts_select" ON customer_contracts
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "customer_contracts_update" ON customer_contracts
  FOR UPDATE USING (org_id = current_user_org_id());

CREATE POLICY "customer_contracts_delete" ON customer_contracts
  FOR DELETE USING (org_id = current_user_org_id());

CREATE INDEX idx_customer_contracts_org      ON customer_contracts(org_id);
CREATE INDEX idx_customer_contracts_end_date ON customer_contracts(org_id, end_date);
CREATE INDEX idx_customer_contracts_status   ON customer_contracts(org_id, status);
