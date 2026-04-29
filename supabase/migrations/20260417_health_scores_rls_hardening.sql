-- ============================================================
-- ORBIT: Hardening Health Scores RLS
-- Enforces AAL2 on support functions and recent health score tables.
-- ============================================================

-- 1. Enforce AAL2 in core support helper functions
CREATE OR REPLACE FUNCTION is_support_user()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_users
    WHERE id = auth.uid() AND is_active = true
  ) AND (auth.jwt()->>'aal') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION get_support_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM support_users
  WHERE id = auth.uid() AND is_active = true AND (auth.jwt()->>'aal') = 'aal2';
$$;

-- 2. Customer Notifications (Customer Access)
DROP POLICY IF EXISTS "customers_select_own_notifications" ON customer_notifications;
CREATE POLICY "customers_select_own_notifications"
  ON customer_notifications
  FOR SELECT
  TO authenticated
  USING (org_id = current_user_org_id());

DROP POLICY IF EXISTS "customers_update_own_notifications" ON customer_notifications;
CREATE POLICY "customers_update_own_notifications"
  ON customer_notifications
  FOR UPDATE
  TO authenticated
  USING (org_id = current_user_org_id())
  WITH CHECK (org_id = current_user_org_id());

-- 3. Customer Notifications (Support JIT Access)
DROP POLICY IF EXISTS "support_jit_select_notifications" ON customer_notifications;
CREATE POLICY "support_jit_select_notifications"
  ON customer_notifications
  FOR SELECT
  TO authenticated
  USING (has_support_access_to(org_id));

-- 4. Customer Health Scores (Support Access)
DROP POLICY IF EXISTS "support_users_select_health_scores" ON customer_health_scores;
CREATE POLICY "support_users_select_health_scores"
  ON customer_health_scores
  FOR SELECT
  TO authenticated
  USING (is_support_user());

-- 5. Nudges (Support Access)
DROP POLICY IF EXISTS "support_users_select_nudges" ON nudges;
CREATE POLICY "support_users_select_nudges"
  ON nudges
  FOR SELECT
  TO authenticated
  USING (is_support_user());

DROP POLICY IF EXISTS "support_users_insert_nudges" ON nudges;
CREATE POLICY "support_users_insert_nudges"
  ON nudges
  FOR INSERT
  TO authenticated
  WITH CHECK (is_support_user());
