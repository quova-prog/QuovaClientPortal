-- ============================================================
-- QUOVA: Add email_sent_at to alerts table
-- Prevents duplicate urgent emails on alert re-upsert
-- ============================================================

ALTER TABLE alerts ADD COLUMN email_sent_at TIMESTAMPTZ DEFAULT NULL;
