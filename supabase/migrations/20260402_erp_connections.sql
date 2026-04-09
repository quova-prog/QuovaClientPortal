-- ERP / TMS Integration Connections
-- Stores non-sensitive connection config and status per org.
-- Credentials are NEVER stored in plaintext — only a flag confirming they've been configured.

CREATE TABLE erp_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  connector_type   TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  config           JSONB NOT NULL DEFAULT '{}',            -- host_url, token_url, account_id, company_codes[], etc. (NO secrets)
  credentials_set  BOOLEAN NOT NULL DEFAULT FALSE,         -- true once creds have been entered (they are NOT stored here)
  sync_modules     TEXT[] NOT NULL DEFAULT '{}',           -- ar | ap | po | so | gl | fx_rates | hedges | cash
  sync_frequency   TEXT NOT NULL DEFAULT 'hourly' CHECK (sync_frequency IN ('15min', 'hourly', '4hour', 'daily')),
  last_synced_at   TIMESTAMPTZ,
  last_sync_status TEXT,                                   -- success | error
  last_sync_count  INTEGER,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE erp_connections ENABLE ROW LEVEL SECURITY;

-- Org-scoped read
CREATE POLICY "erp_connections_select" ON erp_connections
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- Org-scoped insert (admin/editor only)
CREATE POLICY "erp_connections_insert" ON erp_connections
  FOR INSERT WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'editor')
  );

-- Org-scoped update (admin/editor only)
CREATE POLICY "erp_connections_update" ON erp_connections
  FOR UPDATE
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'editor')
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Org-scoped delete (admin/editor only)
CREATE POLICY "erp_connections_delete" ON erp_connections
  FOR DELETE USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'editor')
  );

-- Index for common query pattern
CREATE INDEX erp_connections_org_idx ON erp_connections (org_id);
