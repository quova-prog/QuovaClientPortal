-- ============================================================
-- Payment Methods
-- One payment method record per organisation.
-- Stores metadata only — no raw card/account numbers.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_payment_methods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  payment_type     TEXT NOT NULL CHECK (payment_type IN ('credit_card', 'ach', 'invoice')),

  -- Credit card metadata
  cc_cardholder_name  TEXT,
  cc_brand            TEXT CHECK (cc_brand IN ('visa', 'mastercard', 'amex', 'discover')),
  cc_last_four        TEXT CHECK (cc_last_four ~ '^\d{4}$'),
  cc_expiry_month     SMALLINT CHECK (cc_expiry_month BETWEEN 1 AND 12),
  cc_expiry_year      SMALLINT CHECK (cc_expiry_year >= 2024),

  -- ACH metadata
  ach_account_holder  TEXT,
  ach_bank_name       TEXT,
  ach_account_type    TEXT CHECK (ach_account_type IN ('checking', 'savings')),
  ach_last_four       TEXT CHECK (ach_last_four ~ '^\d{4}$'),

  -- Invoice metadata
  invoice_contact_name  TEXT,
  invoice_email         TEXT,
  invoice_terms         TEXT CHECK (invoice_terms IN ('net_15', 'net_30', 'net_60')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE org_payment_methods ENABLE ROW LEVEL SECURITY;

-- Support staff can read payment methods (via service role / RPC)
-- Customers cannot access this table directly
CREATE POLICY "no_direct_access" ON org_payment_methods
  FOR ALL USING (false);

-- ── RPC: support_set_payment_method ──────────────────────
CREATE OR REPLACE FUNCTION support_set_payment_method(
  p_org_id              UUID,
  p_payment_type        TEXT,
  -- credit card
  p_cc_cardholder_name  TEXT DEFAULT NULL,
  p_cc_brand            TEXT DEFAULT NULL,
  p_cc_last_four        TEXT DEFAULT NULL,
  p_cc_expiry_month     SMALLINT DEFAULT NULL,
  p_cc_expiry_year      SMALLINT DEFAULT NULL,
  -- ach
  p_ach_account_holder  TEXT DEFAULT NULL,
  p_ach_bank_name       TEXT DEFAULT NULL,
  p_ach_account_type    TEXT DEFAULT NULL,
  p_ach_last_four       TEXT DEFAULT NULL,
  -- invoice
  p_invoice_contact_name  TEXT DEFAULT NULL,
  p_invoice_email         TEXT DEFAULT NULL,
  p_invoice_terms         TEXT DEFAULT NULL,
  -- audit
  p_reason              TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email  TEXT;
  v_actor_role   TEXT;
  v_org_name     TEXT;
  v_old_type     TEXT;
BEGIN
  -- 1. Verify caller is an active support_admin
  SELECT email, role
    INTO v_actor_email, v_actor_role
    FROM support_users
   WHERE id = auth.uid()
     AND is_active = true;

  IF NOT FOUND OR v_actor_role != 'support_admin' THEN
    RAISE EXCEPTION 'Access denied: support_admin role required';
  END IF;

  -- 2. Validate payment type
  IF p_payment_type NOT IN ('credit_card', 'ach', 'invoice') THEN
    RAISE EXCEPTION 'Invalid payment type';
  END IF;

  -- 3. Validate reason
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for data corrections';
  END IF;

  -- 4. Get org name and current payment type
  SELECT o.name, pm.payment_type
    INTO v_org_name, v_old_type
    FROM organisations o
    LEFT JOIN org_payment_methods pm ON pm.org_id = o.id
   WHERE o.id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  -- 5. Upsert payment method (clears all type-specific fields on type change)
  INSERT INTO org_payment_methods (
    org_id, payment_type,
    cc_cardholder_name, cc_brand, cc_last_four, cc_expiry_month, cc_expiry_year,
    ach_account_holder, ach_bank_name, ach_account_type, ach_last_four,
    invoice_contact_name, invoice_email, invoice_terms,
    updated_at
  ) VALUES (
    p_org_id, p_payment_type,
    p_cc_cardholder_name, p_cc_brand, p_cc_last_four, p_cc_expiry_month, p_cc_expiry_year,
    p_ach_account_holder, p_ach_bank_name, p_ach_account_type, p_ach_last_four,
    p_invoice_contact_name, p_invoice_email, p_invoice_terms,
    now()
  )
  ON CONFLICT (org_id) DO UPDATE SET
    payment_type          = EXCLUDED.payment_type,
    cc_cardholder_name    = EXCLUDED.cc_cardholder_name,
    cc_brand              = EXCLUDED.cc_brand,
    cc_last_four          = EXCLUDED.cc_last_four,
    cc_expiry_month       = EXCLUDED.cc_expiry_month,
    cc_expiry_year        = EXCLUDED.cc_expiry_year,
    ach_account_holder    = EXCLUDED.ach_account_holder,
    ach_bank_name         = EXCLUDED.ach_bank_name,
    ach_account_type      = EXCLUDED.ach_account_type,
    ach_last_four         = EXCLUDED.ach_last_four,
    invoice_contact_name  = EXCLUDED.invoice_contact_name,
    invoice_email         = EXCLUDED.invoice_email,
    invoice_terms         = EXCLUDED.invoice_terms,
    updated_at            = EXCLUDED.updated_at;

  -- 6. Write immutable audit entry
  INSERT INTO support_audit_logs (
    actor_id, actor_email, actor_role,
    target_org_id, target_org_name,
    action, resource, resource_id,
    summary, metadata
  ) VALUES (
    auth.uid(), v_actor_email, v_actor_role,
    p_org_id, v_org_name,
    'data_correction', 'payment_method', p_org_id::TEXT,
    'Set payment method to ' || p_payment_type ||
      COALESCE(' (was ' || v_old_type || ')', ' (new)') || ' — ' || p_reason,
    jsonb_build_object(
      'old_type', v_old_type,
      'new_type', p_payment_type,
      'reason',   p_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION support_set_payment_method(
  UUID, TEXT, TEXT, TEXT, TEXT, SMALLINT, SMALLINT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION support_set_payment_method(
  UUID, TEXT, TEXT, TEXT, TEXT, SMALLINT, SMALLINT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
