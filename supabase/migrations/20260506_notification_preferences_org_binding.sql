-- ============================================================
-- ORBIT: Bind notification_preferences org_id to caller profile
--
-- Prior policies allowed a user to INSERT / UPDATE their own
-- notification_preferences row based only on user_id = auth.uid().
-- Because org_id is used by service-role Edge Functions to select
-- digest / urgent-alert recipients, a malicious user could attempt
-- to repoint their row at another tenant org_id.
--
-- This migration:
--   1. Repairs any existing rows whose org_id differs from profiles.org_id.
--   2. Recreates INSERT / UPDATE policies so user_id and org_id are both
--      bound to the authenticated caller, with explicit AAL2.
-- ============================================================

BEGIN;

-- Repair existing rows before tightening the policy.
UPDATE notification_preferences np
   SET org_id = p.org_id,
       updated_at = NOW()
  FROM profiles p
 WHERE np.user_id = p.id
   AND np.org_id IS DISTINCT FROM p.org_id;

DROP POLICY IF EXISTS "notif_prefs_insert" ON notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_update" ON notification_preferences;

CREATE POLICY "notif_prefs_insert" ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = current_user_org_id()
    AND (auth.jwt()->>'aal') = 'aal2'
  );

CREATE POLICY "notif_prefs_update" ON notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND org_id = current_user_org_id()
    AND (auth.jwt()->>'aal') = 'aal2'
  )
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = current_user_org_id()
    AND (auth.jwt()->>'aal') = 'aal2'
  );

COMMIT;
