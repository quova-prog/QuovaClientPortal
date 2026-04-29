-- ============================================================
-- QUOVA: Commodity Risk Module Foundation
-- Adds modules entitlement and core commodity tracking tables.
-- ============================================================

-- Ensure the updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Add modules entitlement to organisations
ALTER TABLE organisations
ADD COLUMN modules TEXT[] NOT NULL DEFAULT ARRAY['fx'];

-- 2. Commodity Exposures
CREATE TABLE commodity_exposures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entity_id       UUID REFERENCES entities(id) ON DELETE SET NULL,
  commodity_type  TEXT NOT NULL, -- e.g., 'brent_crude', 'henry_hub_ng', 'copper'
  unit_of_measure TEXT NOT NULL, -- e.g., 'bbl', 'MMBtu', 'mt'
  direction       TEXT NOT NULL CHECK (direction IN ('consume', 'produce')),
  volume          NUMERIC NOT NULL CHECK (volume > 0),
  price_index_reference TEXT NOT NULL,
  delivery_start_date DATE NOT NULL,
  delivery_end_date   DATE NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partially_hedged')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for commodity_exposures
ALTER TABLE commodity_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's commodity exposures"
  ON commodity_exposures FOR SELECT
  USING (
    org_id = current_user_org_id() 
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can insert commodity exposures"
  ON commodity_exposures FOR INSERT
  WITH CHECK (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can update commodity exposures"
  ON commodity_exposures FOR UPDATE
  USING (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can delete commodity exposures"
  ON commodity_exposures FOR DELETE
  USING (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

-- Support JIT Access
CREATE POLICY "Support JIT view commodity exposures"
  ON commodity_exposures FOR SELECT
  USING (has_support_access_to(org_id));

-- 3. Commodity Hedges
CREATE TABLE commodity_hedges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entity_id       UUID REFERENCES entities(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('future', 'swap', 'option')),
  commodity_type  TEXT NOT NULL,
  price_index_reference TEXT NOT NULL,
  unit_of_measure TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  volume          NUMERIC NOT NULL CHECK (volume > 0),
  contracted_price NUMERIC NOT NULL,
  trade_date      DATE NOT NULL,
  settlement_date DATE NOT NULL,
  counterparty_bank TEXT,
  reference_number TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'rolled', 'closed')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for commodity_hedges
ALTER TABLE commodity_hedges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's commodity hedges"
  ON commodity_hedges FOR SELECT
  USING (
    org_id = current_user_org_id() 
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can insert commodity hedges"
  ON commodity_hedges FOR INSERT
  WITH CHECK (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can update commodity hedges"
  ON commodity_hedges FOR UPDATE
  USING (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "Admins/Editors can delete commodity hedges"
  ON commodity_hedges FOR DELETE
  USING (
    org_id = current_user_org_id() 
    AND current_user_role() IN ('admin', 'editor')
    AND (auth.jwt()->>'aal') = 'aal2'
  );

-- Support JIT Access
CREATE POLICY "Support JIT view commodity hedges"
  ON commodity_hedges FOR SELECT
  USING (has_support_access_to(org_id));

-- Trigger for updated_at
CREATE TRIGGER trg_commodity_exposures_updated_at
  BEFORE UPDATE ON commodity_exposures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_commodity_hedges_updated_at
  BEFORE UPDATE ON commodity_hedges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
