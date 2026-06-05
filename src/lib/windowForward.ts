import type { HedgePosition } from '@/types'

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
