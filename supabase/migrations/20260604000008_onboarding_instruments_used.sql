-- ============================================================
-- Window Forwards — Phase 5E: capture instruments used during onboarding
-- Adds organization_profiles.instruments_used so the SETUP step can record
-- which hedging instruments the customer already uses. Used to pre-seed the
-- hedge-policy allowed-instruments default and personalize advisor copy.
-- ============================================================

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS instruments_used TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
