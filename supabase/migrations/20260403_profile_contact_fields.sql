-- ============================================================
-- Add contact fields (email, phone) to profiles
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;
