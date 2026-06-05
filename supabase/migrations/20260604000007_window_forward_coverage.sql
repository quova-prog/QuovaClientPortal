-- ============================================================
-- Window Forwards — Phase 3: coverage view effective-notional
-- Recreate v_hedge_coverage so a window forward contributes only its
-- UNDRAWN residual (notional_base - drawn_notional) to net hedged, while
-- every other instrument keeps contributing full notional_base. This
-- mirrors src/lib/windowForward.ts effectiveHedgedNotional() exactly.
-- Output columns are unchanged, so CREATE OR REPLACE is safe.
-- ============================================================

CREATE OR REPLACE VIEW v_hedge_coverage AS
SELECT
  es.org_id,
  es.currency_pair,
  es.net_exposure,
  COALESCE(hp.net_hedged, 0) AS total_hedged,
  CASE
    WHEN ABS(es.net_exposure) = 0 THEN 100.0
    ELSE ROUND((COALESCE(hp.net_hedged, 0) / NULLIF(ABS(es.net_exposure), 0)) * 100, 2)
  END AS coverage_pct,
  ABS(es.net_exposure) - COALESCE(hp.net_hedged, 0) AS unhedged_amount
FROM v_exposure_summary es
LEFT JOIN (
  SELECT
    org_id,
    currency_pair,
    ABS(
      SUM(CASE WHEN direction = 'sell'
               THEN (CASE WHEN instrument_type = 'window_forward'
                          THEN GREATEST(notional_base - drawn_notional, 0)
                          ELSE notional_base END)
               ELSE 0 END) -
      SUM(CASE WHEN direction = 'buy'
               THEN (CASE WHEN instrument_type = 'window_forward'
                          THEN GREATEST(notional_base - drawn_notional, 0)
                          ELSE notional_base END)
               ELSE 0 END)
    ) AS net_hedged
  FROM hedge_positions
  WHERE status = 'active'
  GROUP BY org_id, currency_pair
) hp ON hp.org_id = es.org_id AND hp.currency_pair = es.currency_pair;

-- Re-assert security_invoker (CREATE OR REPLACE can reset view options).
ALTER VIEW v_hedge_coverage SET (security_invoker = on);
