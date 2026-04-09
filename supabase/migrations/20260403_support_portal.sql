-- ============================================================
-- ORBIT: Support Portal Foundation (SOC2 CC6.3 / CC7.2)
-- Creates:
--   - support_users      : Orbit internal staff identity table
--   - is_support_user()  : RLS helper
--   - get_support_user_role() : role helper
--   - support_audit_logs : immutable cross-org audit trail
--   - Cross-org SELECT policies on all customer tables
-- ============================================================

-- ── support_users ─────────────────────────────────────────
-- Orbit internal staff. Separate from customer profiles —
-- support users are NOT members of any customer org.

CREATE TABLE support_users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('support', 'support_admin')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_users ENABLE ROW LEVEL SECURITY;

-- Support users may only read their own row
CREATE POLICY "support_users_self_select" ON support_users
  FOR SELECT USING (id = auth.uid());

-- ── Helper functions ──────────────────────────────────────

-- Returns true if the current authenticated user is an active support staff member
CREATE OR REPLACE FUNCTION is_support_user()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_users
    WHERE id = auth.uid() AND is_active = true
  );
$$;

-- Returns the role of the current support user ('support' | 'support_admin' | NULL)
CREATE OR REPLACE FUNCTION get_support_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT role FROM support_users
  WHERE id = auth.uid() AND is_active = true;
$$;

-- ── support_audit_logs ────────────────────────────────────
-- Immutable, global (not org-scoped) audit trail for all
-- actions taken by support staff on customer data.

CREATE TABLE support_audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id         UUID NOT NULL,              -- support_users.id
  actor_email      TEXT NOT NULL,              -- denormalised for retention
  actor_role       TEXT NOT NULL,              -- 'support' | 'support_admin'
  target_org_id    UUID REFERENCES organisations(id) ON DELETE SET NULL,
  target_org_name  TEXT,                       -- denormalised for retention after org deletion
  action           TEXT NOT NULL,              -- see action vocab below
  resource         TEXT NOT NULL,              -- table or resource name
  resource_id      TEXT,                       -- UUID or identifier of affected record
  summary          TEXT,                       -- human-readable one-liner
  metadata         JSONB DEFAULT '{}'::jsonb,  -- { before, after, extra context }
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Action vocabulary:
-- 'login'            — support user signed in to support portal
-- 'logout'           — support user signed out
-- 'view_tenant'      — support user viewed a customer org
-- 'impersonate'      — support user entered read-only impersonation of a customer
-- 'end_impersonate'  — support user exited impersonation
-- 'view_audit_log'   — support user searched customer audit logs
-- 'update_user'      — support_admin modified a customer user record
-- 'data_correction'  — support_admin performed a manual data correction

ALTER TABLE support_audit_logs ENABLE ROW LEVEL SECURITY;

-- Any active support user may insert their own logs
CREATE POLICY "support_audit_logs_insert" ON support_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND is_support_user());

-- Any active support user may read all support logs
CREATE POLICY "support_audit_logs_select" ON support_audit_logs
  FOR SELECT USING (is_support_user());

-- Immutability: no UPDATE or DELETE allowed (SOC2 CC7.2)
CREATE OR REPLACE FUNCTION prevent_support_audit_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'support_audit_logs are immutable — rows may not be updated or deleted (SOC2 CC7.2)';
END;
$$;

CREATE TRIGGER trg_support_audit_logs_immutable
  BEFORE DELETE OR UPDATE ON support_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_support_audit_log_mutation();

-- ── Server-side field enforcement ────────────────────────
-- Overwrite actor_email, actor_role, and created_at from server state
-- so the client cannot forge identity or backdate entries.
CREATE OR REPLACE FUNCTION enforce_support_audit_log_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
  v_role  TEXT;
BEGIN
  SELECT email, role INTO v_email, v_role
    FROM support_users
   WHERE id = NEW.actor_id AND is_active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'actor_id does not match an active support user';
  END IF;

  NEW.actor_email := v_email;
  NEW.actor_role  := v_role;
  NEW.created_at  := NOW();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_audit_logs_enforce_fields
  BEFORE INSERT ON support_audit_logs
  FOR EACH ROW EXECUTE FUNCTION enforce_support_audit_log_fields();

CREATE INDEX idx_support_audit_logs_actor      ON support_audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_support_audit_logs_target_org ON support_audit_logs(target_org_id, created_at DESC);
CREATE INDEX idx_support_audit_logs_action     ON support_audit_logs(action, created_at DESC);

-- ── Cross-org SELECT policies for support users ───────────
-- Supabase evaluates multiple policies with OR logic.
-- These additive policies allow support staff to read across
-- all orgs without touching or loosening existing customer policies.

-- organisations
CREATE POLICY "organisations_support_select" ON organisations
  FOR SELECT USING (is_support_user());

-- profiles
CREATE POLICY "profiles_support_select" ON profiles
  FOR SELECT USING (is_support_user());

-- hedge_policies
CREATE POLICY "hedge_policies_support_select" ON hedge_policies
  FOR SELECT USING (is_support_user());

-- fx_exposures
CREATE POLICY "fx_exposures_support_select" ON fx_exposures
  FOR SELECT USING (is_support_user());

-- hedge_positions
CREATE POLICY "hedge_positions_support_select" ON hedge_positions
  FOR SELECT USING (is_support_user());

-- upload_batches
CREATE POLICY "upload_batches_support_select" ON upload_batches
  FOR SELECT USING (is_support_user());

-- alerts
CREATE POLICY "alerts_support_select" ON alerts
  FOR SELECT USING (is_support_user());

-- entities
CREATE POLICY "entities_support_select" ON entities
  FOR SELECT USING (is_support_user());

-- erp_connections
CREATE POLICY "erp_connections_support_select" ON erp_connections
  FOR SELECT USING (is_support_user());

-- audit_logs (customer-facing; support can read across all orgs)
CREATE POLICY "audit_logs_support_select" ON audit_logs
  FOR SELECT USING (is_support_user());

-- bank_accounts
CREATE POLICY "bank_accounts_support_select" ON bank_accounts
  FOR SELECT USING (is_support_user());

-- upload data tables
CREATE POLICY "budget_rates_support_select" ON budget_rates
  FOR SELECT USING (is_support_user());

CREATE POLICY "revenue_forecasts_support_select" ON revenue_forecasts
  FOR SELECT USING (is_support_user());

CREATE POLICY "purchase_orders_support_select" ON purchase_orders
  FOR SELECT USING (is_support_user());

CREATE POLICY "cash_flows_support_select" ON cash_flows
  FOR SELECT USING (is_support_user());

CREATE POLICY "loan_schedules_support_select" ON loan_schedules
  FOR SELECT USING (is_support_user());

CREATE POLICY "payroll_support_select" ON payroll
  FOR SELECT USING (is_support_user());

CREATE POLICY "intercompany_transfers_support_select" ON intercompany_transfers
  FOR SELECT USING (is_support_user());

CREATE POLICY "capex_support_select" ON capex
  FOR SELECT USING (is_support_user());

CREATE POLICY "supplier_contracts_support_select" ON supplier_contracts
  FOR SELECT USING (is_support_user());

CREATE POLICY "customer_contracts_support_select" ON customer_contracts
  FOR SELECT USING (is_support_user());
