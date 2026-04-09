-- ============================================================
-- ORBIT MVP — Bank Accounts
-- ============================================================

CREATE TABLE bank_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  bank_name             TEXT NOT NULL,                           -- e.g. 'BMO', 'TD', 'RBC'
  account_name          TEXT NOT NULL,                           -- e.g. 'BMO Operating CAD'
  account_number_masked TEXT NOT NULL DEFAULT '****0000',        -- masked, e.g. '****8421'
  currency              TEXT NOT NULL DEFAULT 'CAD',             -- ISO 4217
  balance               NUMERIC(20, 2) NOT NULL DEFAULT 0,
  account_type          TEXT NOT NULL DEFAULT 'Chequing',        -- Chequing | Savings | Foreign Currency | Money Market
  status                TEXT NOT NULL DEFAULT 'active',          -- active | disconnected | error

  swift_bic             TEXT,
  iban                  TEXT,
  notes                 TEXT,

  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only see accounts belonging to their own org
CREATE POLICY "bank_accounts_select" ON bank_accounts
  FOR SELECT USING (
    org_id = (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "bank_accounts_insert" ON bank_accounts
  FOR INSERT WITH CHECK (
    org_id = (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "bank_accounts_update" ON bank_accounts
  FOR UPDATE USING (
    org_id = (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "bank_accounts_delete" ON bank_accounts
  FOR DELETE USING (
    org_id = (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX bank_accounts_org_id_idx ON bank_accounts (org_id);
CREATE INDEX bank_accounts_status_idx ON bank_accounts (org_id, status);
