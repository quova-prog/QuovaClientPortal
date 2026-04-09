-- Fix upload_batches RLS: same issue as profiles — FOR ALL USING blocks inserts
-- for users whose org is established but the USING check applies to WITH CHECK too.

DROP POLICY IF EXISTS "org_isolation" ON upload_batches;

CREATE POLICY "upload_batches_insert" ON upload_batches
  FOR INSERT TO authenticated WITH CHECK (org_id = current_user_org_id());

CREATE POLICY "upload_batches_select_update_delete" ON upload_batches
  FOR ALL USING (org_id = current_user_org_id());
