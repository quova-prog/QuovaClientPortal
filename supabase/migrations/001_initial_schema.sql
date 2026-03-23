-- ============================================================
-- ORBIT MVP — Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ORGANISATIONS ──────────────────────────────────────────
-- Each Orbit customer (e.g. Celonis) is an organisation.
-- Multi-tenant: all data is scoped to org_id.

CREATE TABLE organisations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  domain      TEXT,                          -- e.g. celonis.com
  plan        TEXT NOT NULL DEFAULT 'trial', -- trial | starter | growth
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PROFILES ───────────────────────────────────────────────
-- Extends Supabase auth.users with org membership and role.

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'viewer', -- admin | editor | viewer
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── HEDGE POLICY ───────────────────────────────────────────
-- One policy per org. Defines hedging rules.

CREATE TABLE hedge_policies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL DEFAULT 'Default Policy',
  min_coverage_pct      NUMERIC(5,2) NOT NULL DEFAULT 60.0,  -- e.g. 60%
  max_coverage_pct      NUMERIC(5,2) NOT NULL DEFAULT 90.0,  -- e.g. 90%
  min_notional_threshold NUMERIC(20,2) NOT NULL DEFAULT 500000, -- only hedge above this
  min_tenor_days        INTEGER NOT NULL DEFAULT 30,          -- only hedge if >30 days
  base_currency         TEXT NOT NULL DEFAULT 'USD',
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── FX EXPOSURES ───────────────────────────────────────────
-- Uploaded from ERP (Workday CSV export).
-- Each row = one open FX exposure (AR or AP item).

CREATE TABLE fx_exposures (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  upload_batch_id   UUID,                          -- links rows from same CSV upload
  entity            TEXT NOT NULL,                 -- e.g. "Celonis SE", "Celonis Inc"
  currency_pair     TEXT NOT NULL,                 -- e.g. "EUR/USD"
  base_currency     TEXT NOT NULL,                 -- e.g. "EUR"
  quote_currency    TEXT NOT NULL,                 -- e.g. "USD"
  direction         TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  notional_base     NUMERIC(20,2) NOT NULL,         -- amount in base currency
  notional_usd      NUMERIC(20,2),                 -- converted to USD for comparison
  settlement_date   DATE NOT NULL,
  description       TEXT,                          -- invoice/PO reference
  source_system     TEXT DEFAULT 'workday',
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partially_hedged')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── UPLOAD BATCHES ─────────────────────────────────────────
-- Tracks each CSV file upload for audit purposes.

CREATE TABLE upload_batches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES profiles(id),
  filename      TEXT NOT NULL,
  row_count     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'complete', 'failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── HEDGE POSITIONS ────────────────────────────────────────
-- Manually entered FX forward/swap positions.

CREATE TABLE hedge_positions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by        UUID REFERENCES profiles(id),
  instrument_type   TEXT NOT NULL CHECK (instrument_type IN ('forward', 'swap', 'option', 'spot')),
  currency_pair     TEXT NOT NULL,                 -- e.g. "EUR/USD"
  base_currency     TEXT NOT NULL,
  quote_currency    TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  notional_base     NUMERIC(20,2) NOT NULL,
  notional_usd      NUMERIC(20,2),
  contracted_rate   NUMERIC(20,8) NOT NULL,        -- forward rate
  spot_rate_at_trade NUMERIC(20,8),
  trade_date        DATE NOT NULL,
  value_date        DATE NOT NULL,                 -- settlement / maturity
  counterparty_bank TEXT,                          -- e.g. "JPMorgan", "BMO"
  reference_number  TEXT,                          -- bank confirmation ref
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── FX RATES ───────────────────────────────────────────────
-- Spot rates for USD conversion. Updated manually or via API later.

CREATE TABLE fx_rates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency_pair TEXT NOT NULL,           -- e.g. "EUR/USD"
  rate          NUMERIC(20,8) NOT NULL,
  rate_date     DATE NOT NULL,
  source        TEXT DEFAULT 'manual',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (currency_pair, rate_date)
);

-- ── VIEWS ──────────────────────────────────────────────────

-- Exposure summary by currency pair (for dashboard cards)
CREATE VIEW v_exposure_summary AS
SELECT
  e.org_id,
  e.currency_pair,
  e.base_currency,
  e.quote_currency,
  SUM(CASE WHEN e.direction = 'receivable' THEN e.notional_base ELSE 0 END) AS total_receivable,
  SUM(CASE WHEN e.direction = 'payable'    THEN e.notional_base ELSE 0 END) AS total_payable,
  SUM(CASE WHEN e.direction = 'receivable' THEN e.notional_base
           WHEN e.direction = 'payable'    THEN -e.notional_base ELSE 0 END) AS net_exposure,
  SUM(COALESCE(e.notional_usd, 0)) AS total_usd_equivalent,
  COUNT(*) AS exposure_count,
  MIN(e.settlement_date) AS earliest_settlement,
  MAX(e.settlement_date) AS latest_settlement
FROM fx_exposures e
WHERE e.status = 'open'
GROUP BY e.org_id, e.currency_pair, e.base_currency, e.quote_currency;

-- Hedge coverage by currency pair (for coverage analysis)
CREATE VIEW v_hedge_coverage AS
SELECT
  es.org_id,
  es.currency_pair,
  es.net_exposure,
  COALESCE(hp.total_hedged, 0) AS total_hedged,
  CASE
    WHEN ABS(es.net_exposure) = 0 THEN 100.0
    ELSE ROUND((COALESCE(hp.total_hedged, 0) / NULLIF(ABS(es.net_exposure), 0)) * 100, 2)
  END AS coverage_pct,
  ABS(es.net_exposure) - COALESCE(hp.total_hedged, 0) AS unhedged_amount
FROM v_exposure_summary es
LEFT JOIN (
  SELECT
    org_id,
    currency_pair,
    SUM(notional_base) AS total_hedged
  FROM hedge_positions
  WHERE status = 'active'
  GROUP BY org_id, currency_pair
) hp ON hp.org_id = es.org_id AND hp.currency_pair = es.currency_pair;

-- ── ROW-LEVEL SECURITY ─────────────────────────────────────
-- Ensures each user only sees their own organisation's data.

ALTER TABLE organisations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedge_policies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_exposures    ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedge_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates        ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's org_id
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Policies: users see only their org's data
CREATE POLICY "org_isolation" ON organisations
  FOR ALL USING (id = current_user_org_id());

CREATE POLICY "org_isolation" ON profiles
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY "org_isolation" ON hedge_policies
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY "org_isolation" ON fx_exposures
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY "org_isolation" ON upload_batches
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY "org_isolation" ON hedge_positions
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY "org_isolation" ON fx_rates
  FOR ALL USING (TRUE); -- rates are global/public

-- ── INDEXES ────────────────────────────────────────────────
CREATE INDEX idx_fx_exposures_org_currency  ON fx_exposures(org_id, currency_pair);
CREATE INDEX idx_fx_exposures_settlement    ON fx_exposures(settlement_date);
CREATE INDEX idx_fx_exposures_status        ON fx_exposures(org_id, status);
CREATE INDEX idx_hedge_positions_org        ON hedge_positions(org_id, status);
CREATE INDEX idx_fx_rates_pair_date         ON fx_rates(currency_pair, rate_date DESC);

-- ── SEED: Common FX rates ───────────────────────────────────
INSERT INTO fx_rates (currency_pair, rate, rate_date, source) VALUES
  ('EUR/USD', 1.0850, CURRENT_DATE, 'seed'),
  ('GBP/USD', 1.2650, CURRENT_DATE, 'seed'),
  ('USD/CAD', 1.3580, CURRENT_DATE, 'seed'),
  ('USD/JPY', 149.50, CURRENT_DATE, 'seed'),
  ('AUD/USD', 0.6520, CURRENT_DATE, 'seed'),
  ('USD/CHF', 0.8840, CURRENT_DATE, 'seed'),
  ('USD/SEK', 10.420, CURRENT_DATE, 'seed'),
  ('USD/NOK', 10.620, CURRENT_DATE, 'seed'),
  ('USD/DKK', 6.8900, CURRENT_DATE, 'seed'),
  ('EUR/GBP', 0.8570, CURRENT_DATE, 'seed')
ON CONFLICT (currency_pair, rate_date) DO NOTHING;
