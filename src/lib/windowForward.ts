import type { HedgePosition } from '@/types'
import { toUsd } from '@/lib/fx'

// Window-forward valuation & coverage helpers (Phase 3+).
//
// This module is the SINGLE SOURCE OF TRUTH for window-forward-aware
// coverage math on the client. The DB view `v_hedge_coverage` mirrors the
// same rule in SQL; a vitest parity test locks the two together.
//
// MTM (indicative) lands here in Phase 4. Hedge accounting is deliberately
// a separate spec and never produces journal entries from this module.

/**
 * The notional a position currently contributes to hedge coverage.
 *
 * For a window forward, only the UNDRAWN residual counts — drawn slices
 * have settled the underlying exposure and drop out (so coverage falls in
 * lockstep with the exposure as the window is drawn down). Every other
 * instrument contributes its full notional.
 *
 * Floored at zero defensively; the DB CHECK already bounds drawn_notional
 * to [0, notional_base], but a client-side fixture could violate it.
 */
export function effectiveHedgedNotional(position: HedgePosition): number {
  if (position.instrument_type === 'window_forward') {
    return Math.max(0, position.notional_base - (position.drawn_notional ?? 0))
  }
  return position.notional_base
}

/** Minimal shape needed from a draw to roll up realized economics. */
export interface DrawRealized {
  realized_pnl_usd: number
}

export interface WindowForwardMtm {
  /** Undrawn notional still floating (base currency). */
  remaining: number
  /** Indicative MTM on the undrawn residual, in USD (sign = gain/loss). */
  floatingMtmUsd: number
  /** Sum of stored realized P&L (USD) across settled draws — not recomputed. */
  realizedUsd: number
  /** The indicative mark used (current pair rate, or contracted_rate fallback). */
  currentRate: number
}

/**
 * Indicative MTM for a window forward. Two components:
 *
 *  (A) Drawn notional — settled; its realized P&L is the STORED
 *      `realized_pnl_usd` per draw, summed. Never recomputed here.
 *  (B) Undrawn notional — floats against `contracted_rate`, marked to the
 *      current pair rate (indicative). Direction-aware, USD-converted with
 *      the canonical `toUsd(abs)*sign` pattern used across the app.
 *
 * INDICATIVE only — built from the live/fallback rate map, not an ASC 820
 * exit-price fair value. Bank MTM is the accounting source of truth.
 * Produces no journal entries (hedge accounting is a separate spec).
 */
export function windowForwardMtm(
  position: HedgePosition,
  draws: DrawRealized[],
  ratesMap: Record<string, number>,
): WindowForwardMtm {
  const remaining = Math.max(0, position.notional_base - (position.drawn_notional ?? 0))
  const currentRate = ratesMap[position.currency_pair] ?? position.contracted_rate
  const quoteCcy = position.currency_pair.split('/')[1] ?? 'USD'

  const rawMtm = position.direction === 'sell'
    ? (position.contracted_rate - currentRate) * remaining
    : (currentRate - position.contracted_rate) * remaining
  const floatingMtmUsd = toUsd(Math.abs(rawMtm), quoteCcy, ratesMap) * (rawMtm >= 0 ? 1 : -1)

  const realizedUsd = draws.reduce((s, d) => s + (d.realized_pnl_usd ?? 0), 0)

  return { remaining, floatingMtmUsd, realizedUsd, currentRate }
}
