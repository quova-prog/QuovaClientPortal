-- ============================================================
-- ORBIT: Server-Side AAL2 Enforcement
-- Explicitly demands AAL2 from JWTs to prevent password-only PostgREST calls.
-- ============================================================

-- Elevate core tenancy helpers to demand MFA
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS UUID AS $$
  -- Enforce MFA natively. If AAL1, returning NULL collapses org_isolation to FALSE.
  SELECT org_id FROM profiles 
  WHERE id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2';
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, auth;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles 
  WHERE id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2';
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, auth;


-- Lock down explicitly bypassed auth.uid() queries in existing policies.
-- 1. Rates
DROP POLICY IF EXISTS "rates_write" ON fx_rates;
CREATE POLICY "rates_write" ON fx_rates FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND (auth.jwt()->>'aal') = 'aal2')
);

DROP POLICY IF EXISTS "rates_update" ON fx_rates;
CREATE POLICY "rates_update" ON fx_rates FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND (auth.jwt()->>'aal') = 'aal2')
);

DROP POLICY IF EXISTS "rates_delete" ON fx_rates;
CREATE POLICY "rates_delete" ON fx_rates FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND (auth.jwt()->>'aal') = 'aal2')
);

-- 2. Profiles (Self Updates)
DROP POLICY IF EXISTS "profile_update_self" ON profiles;
CREATE POLICY "profile_update_self" ON profiles FOR UPDATE USING (id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2');

-- 3. Notification Preferences
DROP POLICY IF EXISTS "notif_prefs_select" ON notification_preferences;
CREATE POLICY "notif_prefs_select" ON notification_preferences FOR SELECT USING (user_id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "notif_prefs_insert" ON notification_preferences;
CREATE POLICY "notif_prefs_insert" ON notification_preferences FOR INSERT WITH CHECK (user_id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "notif_prefs_update" ON notification_preferences;
CREATE POLICY "notif_prefs_update" ON notification_preferences FOR UPDATE USING (user_id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2');

-- 4. Support Users
DROP POLICY IF EXISTS "support_users_self_select" ON support_users;
CREATE POLICY "support_users_self_select" ON support_users FOR SELECT USING (id = auth.uid() AND (auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "support_audit_logs_insert" ON support_audit_logs;
CREATE POLICY "support_audit_logs_insert" ON support_audit_logs FOR INSERT WITH CHECK (actor_id = auth.uid() AND is_support_user() AND (auth.jwt()->>'aal') = 'aal2');


-- Connect legacy orphaned auth.uid() policies directly back to the newly hardened current_user_org_id()
-- 5. Bank Accounts
DROP POLICY IF EXISTS "bank_accounts_select" ON bank_accounts;
CREATE POLICY "bank_accounts_select" ON bank_accounts FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "bank_accounts_insert" ON bank_accounts;
CREATE POLICY "bank_accounts_insert" ON bank_accounts FOR INSERT WITH CHECK (org_id = current_user_org_id());

DROP POLICY IF EXISTS "bank_accounts_update" ON bank_accounts;
CREATE POLICY "bank_accounts_update" ON bank_accounts FOR UPDATE USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "bank_accounts_delete" ON bank_accounts;
CREATE POLICY "bank_accounts_delete" ON bank_accounts FOR DELETE USING (org_id = current_user_org_id());

-- 6. Audit Logs
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT WITH CHECK (org_id = current_user_org_id());

-- 7. Alerts (Just Select, others were fixed previously)
DROP POLICY IF EXISTS "alerts_select" ON alerts;
CREATE POLICY "alerts_select" ON alerts FOR SELECT USING (org_id = current_user_org_id());

-- 8. ERP Connections
DROP POLICY IF EXISTS "erp_connections_select" ON erp_connections;
CREATE POLICY "erp_connections_select" ON erp_connections FOR SELECT USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "erp_connections_insert" ON erp_connections;
CREATE POLICY "erp_connections_insert" ON erp_connections FOR INSERT WITH CHECK (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "erp_connections_update" ON erp_connections;
CREATE POLICY "erp_connections_update" ON erp_connections FOR UPDATE USING (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "erp_connections_delete" ON erp_connections;
CREATE POLICY "erp_connections_delete" ON erp_connections FOR DELETE USING (org_id = current_user_org_id() AND current_user_role() IN ('admin', 'editor'));

-- 9. Email Logs
DROP POLICY IF EXISTS "email_logs_select_admin" ON email_logs;
CREATE POLICY "email_logs_select_admin" ON email_logs FOR SELECT USING (org_id = current_user_org_id() AND current_user_role() = 'admin');

-- 10. Onboarding Sessions
DROP POLICY IF EXISTS "onboarding_sessions_insert" ON onboarding_sessions;
CREATE POLICY "onboarding_sessions_insert" ON onboarding_sessions FOR INSERT WITH CHECK (org_id = current_user_org_id() AND created_by = auth.uid());
