-- Migration: 20260416_health_scores_tables.sql
-- Creates customer_health_scores, customer_notifications, and nudges tables
-- with RLS policies and acknowledgment sync trigger.

-- ============================================================
-- TABLE: customer_health_scores
-- One row per org. Written by service role (background job).
-- Support users can read.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_health_scores (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  overall_score INTEGER    NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  status       TEXT        NOT NULL CHECK (status IN ('healthy', 'needs_attention', 'at_risk')),
  dimensions   JSONB       NOT NULL DEFAULT '{}',
  gaps         JSONB       NOT NULL DEFAULT '[]',
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_health_scores_org_id_key UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_health_scores_org_id
  ON customer_health_scores(org_id);

CREATE INDEX IF NOT EXISTS idx_customer_health_scores_status
  ON customer_health_scores(status);

ALTER TABLE customer_health_scores ENABLE ROW LEVEL SECURITY;

-- Support users (active) can SELECT all health scores
CREATE POLICY "support_users_select_health_scores"
  ON customer_health_scores
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_users
      WHERE id = auth.uid()
        AND is_active = true
    )
  );

-- Service role bypasses RLS for writes — no INSERT/UPDATE/DELETE policies needed for clients


-- ============================================================
-- TABLE: customer_notifications
-- In-app notifications generated for customer orgs.
-- Customers read and acknowledge their own. Support reads via JIT.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  gap_type        TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  cta_url         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_notifications_org_id
  ON customer_notifications(org_id);

-- Partial index for fast unacknowledged queries
CREATE INDEX IF NOT EXISTS idx_customer_notifications_unacknowledged
  ON customer_notifications(org_id)
  WHERE acknowledged_at IS NULL;

ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;

-- Customers SELECT their own org's notifications
CREATE POLICY "customers_select_own_notifications"
  ON customer_notifications
  FOR SELECT
  TO authenticated
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Customers UPDATE own org's notifications (to set acknowledged_at)
CREATE POLICY "customers_update_own_notifications"
  ON customer_notifications
  FOR UPDATE
  TO authenticated
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Support users SELECT via JIT access grant
CREATE POLICY "support_jit_select_notifications"
  ON customer_notifications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_access_grants
      WHERE user_id    = auth.uid()
        AND org_id     = customer_notifications.org_id
        AND revoked_at IS NULL
        AND expires_at > now()
    )
  );


-- ============================================================
-- TABLE: nudges
-- Manual nudges sent by support staff to customer orgs.
-- Support users can SELECT and INSERT.
-- ============================================================

CREATE TABLE IF NOT EXISTS nudges (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  gap_type        TEXT        NOT NULL,
  channel         TEXT        NOT NULL CHECK (channel IN ('email', 'in_app', 'both')),
  message         TEXT,
  sent_by         UUID        NOT NULL REFERENCES auth.users(id),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nudges_org_id
  ON nudges(org_id);

-- Composite index for cooldown lookups (prevent spam per org+gap_type)
CREATE INDEX IF NOT EXISTS idx_nudges_cooldown
  ON nudges(org_id, gap_type, sent_at);

ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

-- Support users SELECT all nudges
CREATE POLICY "support_users_select_nudges"
  ON nudges
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_users
      WHERE id = auth.uid()
        AND is_active = true
    )
  );

-- Support users INSERT nudges
CREATE POLICY "support_users_insert_nudges"
  ON nudges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_users
      WHERE id = auth.uid()
        AND is_active = true
    )
  );


-- ============================================================
-- TRIGGER: sync_nudge_acknowledgment
-- When customer_notifications.acknowledged_at is set (NULL → non-NULL),
-- update the most recent matching nudge (same org_id + gap_type,
-- unacknowledged) with the same acknowledged_at timestamp.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_nudge_acknowledgment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when acknowledged_at transitions from NULL to a non-NULL value
  IF OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL THEN
    UPDATE nudges
    SET acknowledged_at = NEW.acknowledged_at
    WHERE id = (
      SELECT id
      FROM nudges
      WHERE org_id          = NEW.org_id
        AND gap_type        = NEW.gap_type
        AND acknowledged_at IS NULL
      ORDER BY sent_at DESC
      LIMIT 1
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_nudge_acknowledgment
  AFTER UPDATE OF acknowledged_at
  ON customer_notifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_nudge_acknowledgment();
