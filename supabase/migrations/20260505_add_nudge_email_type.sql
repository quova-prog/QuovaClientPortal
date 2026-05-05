-- ============================================================
-- ORBIT: Allow 'nudge' as a valid email_logs.email_type
--
-- The send-nudge Edge Function logs email-send results to email_logs
-- with email_type = 'nudge', but the existing CHECK constraint
-- (last set in 20260504_team_invite_email_logs.sql) only permits
-- ('urgent_alert', 'daily_digest', 'weekly_digest', 'team_invite').
-- The constraint silently rejected every nudge log row, costing
-- observability for support-driven email sends.
--
-- Idempotent: drops the prior named constraint if present, re-adds
-- the new one. Safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_email_type_check;

ALTER TABLE email_logs ADD CONSTRAINT email_logs_email_type_check
  CHECK (email_type IN ('urgent_alert', 'daily_digest', 'weekly_digest', 'team_invite', 'nudge'));

COMMIT;
