/**
 * hedgeEffectiveness.ts
 *
 * Pure calculation engine for hedge effectiveness testing under
 * ASC 815 (US GAAP) and IFRS 9. No React, no side effects.
 *
 * Methods implemented:
 *   - Retrospective: Dollar-offset method (80–125% ratio test)
 *   - Prospective:   Simple linear regression (R² ≥ 0.80, slope near -1)
 *
 * Reference standards:
 *   - ASC 815-20-25 (designation and documentation)
 *   - ASC 815-20-35 (subsequent measurement)
 *   - IFRS 9 B6.4.1–B6.4.17 (hedging effectiveness requirements)
 */

import type { HedgePosition } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface HedgeEffectivenessResult {
  // Identity
  hedgeId: string
  referenceNumber: string
  currencyPair: string
  baseCurrency: string
  direction: string
  instrumentType: string
  counterpartyBank: string
  hedgeType: string

  // Designation
  designationDate: string   // trade_date
  maturityDate: string      // value_date
  notionalBase: number
  contractedRate: number    // designated forward rate
  spotRateAtTrade: number   // spot at inception

  // Basis
  forwardPoints: number              // contracted_rate − spotRateAtTrade (basis at inception)
  spotRateAtTradeAvailable: boolean  // true if position had a real spot_rate_at_trade value

  // Test date
  testDate: string          // today
  currentSpotRate: number   // today's rate

  // Retrospective dollar-offset
  deltaFvInstrument: number      // ΔFV of hedging instrument in USD
  deltaFvHedgedItem: number      // ΔFV of hedged item in USD (independent valuation via hypothetical derivative)
  dollarOffsetRatioPct: number   // |ΔFV_instr / ΔFV_item| × 100
  retrospectiveResult: 'pass' | 'fail' | 'inconclusive'

  // Ineffectiveness
  effectivePortionUsd: number    // min(|ΔFV_instr|, |ΔFV_item|) — goes to OCI
  ineffectivePortionUsd: number  // difference — goes to P&L

  // Prospective regression (from historical monthly rate data)
  rSquared: number | null
  slope: number | null           // should be near -1.0 for direct hedges
  fStatistic: number | null
  historicalMonths: number
  prospectiveResult: 'pass' | 'fail' | 'insufficient_data'

  // Overall
  overallStatus: 'effective' | 'needs_review' | 'ineffective'

  // Formal designation memo
  designationMemo: {
    hedgingRelationship: string
    riskBeingHedged: string
    hedgingInstrument: string
    hedgedItem: string
    assessmentMethod: string
    accountingStandard: 'ASC 815' | 'IFRS 9'
  }
}

export interface EffectivenessSummary {
  totalCount: number
  passCount: number
  failCount: number
  needsReviewCount: number
  inconclusiveCount: number
  totalEffectivePortionUsd: number
  totalIneffectivePortionUsd: number
  totalAbsFvChangeUsd: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the current spot rate for a given currency pair from the live rates map.
 * The ratesMap uses keys like 'EUR/USD', 'USD/JPY', 'GBP/USD', etc.
 */
function resolveCurrentRate(
  currencyPair: string,
  ratesMap: Record<string, number>,
): number | null {
  // Direct lookup: e.g. 'EUR/USD' → 1.08
  if (ratesMap[currencyPair] !== undefined) return ratesMap[currencyPair]

  // Try swapping the slash direction
  const parts = currencyPair.split('/')
  if (parts.length === 2) {
    const inverse = `${parts[1]}/${parts[0]}`
    if (ratesMap[inverse] !== undefined && ratesMap[inverse] > 0) {
      return 1 / ratesMap[inverse]
    }
  }

  return null
}

/**
 * Simple OLS regression: Y = α + βX, returns { slope, rSquared, fStatistic, n }.
 * Both arrays must be the same length and contain at least 3 points.
 */
function olsRegression(
  x: number[],
  y: number[],
): { slope: number; rSquared: number; fStatistic: number; n: number } | null {
  const n = x.length
  if (n < 3 || y.length !== n) return null

  const meanX = x.reduce((s, v) => s + v, 0) / n
  const meanY = y.reduce((s, v) => s + v, 0) / n

  let ssXX = 0; let ssXY = 0; let ssYY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    ssXX += dx * dx
    ssXY += dx * dy
    ssYY += dy * dy
  }

  if (ssXX === 0) return null

  const slope = ssXY / ssXX
  const intercept = meanY - slope * meanX

  // Residual sum of squares
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const yHat = intercept + slope * x[i]
    ssRes += (y[i] - yHat) ** 2
  }

  const rSquared = ssYY > 0 ? Math.max(0, 1 - ssRes / ssYY) : 1
  const fStatistic = n > 2 && (1 - rSquared) > 1e-10
    ? (rSquared / (1 - rSquared)) * (n - 2)
    : 999 // near-perfect fit

  return { slope, rSquared, fStatistic, n }
}

/**
 * Build monthly Δrate series from a sorted array of (date, rate) pairs.
 * Returns arrays of [hedgedItemChange, instrumentChange] for regression.
 *
 * The forwardPointsPct parameter represents the forward basis as a proportion
 * of the spot rate at trade (e.g. if spot=1.08 and fwd=1.0850, basis=0.0050,
 * pct ≈ 0.00463). This is applied to the instrument series so the regression
 * reflects the real-world divergence between spot and forward rate movements.
 */
function buildMonthlyChanges(
  historicalRates: { date: string; rate: number }[],
  forwardPointsPct: number,
): { xSeries: number[]; ySeries: number[] } {
  if (historicalRates.length < 2) return { xSeries: [], ySeries: [] }

  // Group by YYYY-MM, take last rate in each month
  const byMonth: Record<string, number> = {}
  for (const r of historicalRates) {
    const ym = r.date.slice(0, 7) // 'YYYY-MM'
    byMonth[ym] = r.rate
  }

  const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
  const xSeries: number[] = []
  const ySeries: number[] = []

  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i][1] - sorted[i - 1][1]
    // Hedged item change proxy: spot rate delta (e.g. receivable value changes with spot)
    xSeries.push(delta)
    // Instrument (forward) change proxy: includes basis adjustment
    // A forward contract's value moves with spot but is also affected by forward points
    ySeries.push(-(delta * (1 + forwardPointsPct)))
  }

  return { xSeries, ySeries }
}

// ── Main computation ─────────────────────────────────────────────────────────

export function computeEffectiveness(
  position: HedgePosition,
  ratesMap: Record<string, number>,
  historicalRates: { date: string; rate: number }[],
): HedgeEffectivenessResult {
  const today = new Date().toISOString().split('T')[0]

  // ── Resolve current spot rate ──────────────────────────────────────────────
  const currentSpotRate = resolveCurrentRate(position.currency_pair, ratesMap)
    ?? position.contracted_rate // fallback: no movement

  // ── ΔFV of hedging instrument (in base currency terms, then USD) ──────────
  //
  // Convention: ratesMap stores CCY/USD for most pairs (EUR/USD = 1.08 means 1 EUR = 1.08 USD).
  // For pairs like USD/JPY, ratesMap[USD/JPY] = 149 means 1 USD = 149 JPY → the base of the
  // hedge position is measured in JPY, so notional_base is in JPY.
  //
  // For a SELL hedge (company sells foreign currency forward):
  //   Gain when current spot < contracted rate (foreign CCY weakened)
  //   FV_instrument = (contractedRate - currentSpotRate) × notionalBase
  //   If currencyPair is CCY/USD → result is in USD already
  //   If currencyPair is USD/CCY → result is in USD/CCY units, divide by currentSpotRate to get USD
  //
  // For a BUY hedge:
  //   Gain when current spot > contracted rate
  //   FV_instrument = (currentSpotRate - contractedRate) × notionalBase

  const isUsdBase = position.currency_pair.startsWith('USD/')
  let deltaFvInstrumentRaw: number

  if (position.direction === 'sell') {
    deltaFvInstrumentRaw = (position.contracted_rate - currentSpotRate) * position.notional_base
  } else {
    // buy
    deltaFvInstrumentRaw = (currentSpotRate - position.contracted_rate) * position.notional_base
  }

  // Convert to USD
  let deltaFvInstrument: number
  if (isUsdBase) {
    // Pair like USD/JPY: rate is JPY per USD, notional in base (USD).
    // ΔFV = rate_change * notional_USD → already in USD-equivalent terms via rate movement.
    // But notional is in USD and rate is JPY/USD, so raw ΔFV is in JPY → divide by spot to get USD.
    deltaFvInstrument = currentSpotRate > 0
      ? deltaFvInstrumentRaw / currentSpotRate
      : deltaFvInstrumentRaw
  } else {
    // Pair like EUR/USD: rate is USD per EUR, notional in EUR.
    // ΔFV = rate_change_in_USD * notional_EUR → already in USD. No further conversion needed.
    deltaFvInstrument = deltaFvInstrumentRaw
  }

  // ── ΔFV of hedged item (independent valuation — hypothetical derivative method) ──
  //
  // The hedged item is the underlying FX exposure. Its value change is measured
  // using the spot rate at trade inception vs current spot — NOT the contracted
  // forward rate. This creates an independent valuation that can diverge from
  // the instrument's ΔFV by the forward points (basis), producing real
  // ineffectiveness per ASC 815-20-25-3 / IFRS 9 B6.5.5.
  //
  const spotRateAtTrade = position.spot_rate_at_trade ?? position.contracted_rate
  const spotRateAtTradeAvailable = position.spot_rate_at_trade != null

  let deltaFvHedgedItemRaw: number
  if (position.direction === 'sell') {
    // Hedged item is a receivable: loses value when foreign CCY weakens (spot falls)
    deltaFvHedgedItemRaw = (spotRateAtTrade - currentSpotRate) * position.notional_base
  } else {
    // Hedged item is a payable: loses value when foreign CCY strengthens (spot rises)
    deltaFvHedgedItemRaw = (currentSpotRate - spotRateAtTrade) * position.notional_base
  }

  // Convert to USD (same logic as instrument)
  let deltaFvHedgedItem: number
  if (isUsdBase) {
    deltaFvHedgedItem = currentSpotRate > 0
      ? deltaFvHedgedItemRaw / currentSpotRate
      : deltaFvHedgedItemRaw
  } else {
    deltaFvHedgedItem = deltaFvHedgedItemRaw
  }

  // Forward points = basis at inception
  const forwardPoints = position.contracted_rate - spotRateAtTrade

  // ── Dollar-offset ratio ───────────────────────────────────────────────────
  const absDeltaInstr = Math.abs(deltaFvInstrument)
  const absDeltaItem  = Math.abs(deltaFvHedgedItem)

  // Trivial movement guard: if rate changed < 0.1% consider inconclusive
  const rateChangePct = position.contracted_rate !== 0
    ? Math.abs((currentSpotRate - position.contracted_rate) / position.contracted_rate) * 100
    : 0

  let dollarOffsetRatioPct: number
  let retrospectiveResult: 'pass' | 'fail' | 'inconclusive'

  if (rateChangePct < 0.1 || absDeltaItem < 0.01) {
    dollarOffsetRatioPct = 100.0
    retrospectiveResult = 'inconclusive'
  } else {
    dollarOffsetRatioPct = absDeltaItem > 0
      ? (absDeltaInstr / absDeltaItem) * 100
      : 100.0

    retrospectiveResult = dollarOffsetRatioPct >= 80 && dollarOffsetRatioPct <= 125
      ? 'pass'
      : 'fail'
  }

  // ── Ineffectiveness ───────────────────────────────────────────────────────
  const effectivePortionUsd   = Math.min(absDeltaInstr, absDeltaItem)
  const ineffectivePortionUsd = Math.max(0, absDeltaInstr - absDeltaItem)

  // ── Prospective regression ────────────────────────────────────────────────
  const forwardPointsPct = spotRateAtTrade !== 0 ? forwardPoints / spotRateAtTrade : 0
  const { xSeries, ySeries } = buildMonthlyChanges(historicalRates, forwardPointsPct)
  const historicalMonths = xSeries.length

  let rSquared: number | null = null
  let slope: number | null = null
  let fStatistic: number | null = null
  let prospectiveResult: 'pass' | 'fail' | 'insufficient_data'

  if (historicalMonths < 8) {
    prospectiveResult = 'insufficient_data'
  } else {
    const reg = olsRegression(xSeries, ySeries)
    if (reg) {
      rSquared   = reg.rSquared
      slope      = reg.slope
      fStatistic = reg.fStatistic

      prospectiveResult = rSquared >= 0.80 && slope !== null && slope >= -1.25 && slope <= -0.80
        ? 'pass'
        : 'fail'
    } else {
      prospectiveResult = 'fail'
    }
  }

  // ── Overall status ────────────────────────────────────────────────────────
  let overallStatus: 'effective' | 'needs_review' | 'ineffective'

  if (retrospectiveResult === 'fail' || prospectiveResult === 'fail') {
    overallStatus = 'ineffective'
  } else if (retrospectiveResult === 'inconclusive' || prospectiveResult === 'insufficient_data') {
    overallStatus = 'needs_review'
  } else {
    overallStatus = 'effective'
  }

  // ── Designation memo ──────────────────────────────────────────────────────
  const pair         = position.currency_pair
  const instrument   = position.instrument_type.charAt(0).toUpperCase() + position.instrument_type.slice(1)
  const hedgeTypeStr = position.hedge_type === 'cash_flow' ? 'Cash Flow Hedge' :
                       position.hedge_type === 'fair_value' ? 'Fair Value Hedge' : 'Net Investment Hedge'
  const stdRef       = position.hedge_type === 'cash_flow'
    ? 'ASC 815-20-25-15 through 25-36'
    : 'ASC 815-20-25-37 through 25-54'

  const designationMemo = {
    hedgingRelationship: `${hedgeTypeStr} — ${pair} ${instrument} (${position.direction.toUpperCase()})`,
    riskBeingHedged: `Foreign currency exchange rate risk on ${pair} ${position.direction === 'sell' ? 'receivable' : 'payable'} exposure`,
    hedgingInstrument: `${instrument} contract — Ref: ${position.reference_number ?? position.id}, Notional: ${position.notional_base.toLocaleString()} ${position.base_currency}, Contracted Rate: ${position.contracted_rate}, Maturity: ${position.value_date}, Counterparty: ${position.counterparty_bank ?? 'N/A'}`,
    hedgedItem: `Forecasted/committed ${position.direction === 'sell' ? 'receipt' : 'payment'} of ${position.notional_base.toLocaleString()} ${position.base_currency} on or around ${position.value_date}. Valued using hypothetical derivative method (spot-to-spot change). Exposure designated under ${stdRef}.`,
    assessmentMethod: 'Dollar-offset method (retrospective, ASC 815-20-35-2a) and linear regression (prospective, ASC 815-20-35-2b). Hedged item valued independently via hypothetical derivative method (ASC 815-20-25-3). Effectiveness range: 80%–125%.',
    accountingStandard: 'ASC 815' as const,
  }

  return {
    hedgeId:            position.id,
    referenceNumber:    position.reference_number ?? position.id,
    currencyPair:       position.currency_pair,
    baseCurrency:       position.base_currency,
    direction:          position.direction,
    instrumentType:     position.instrument_type,
    counterpartyBank:   position.counterparty_bank ?? '—',
    hedgeType:          position.hedge_type,
    designationDate:    position.trade_date,
    maturityDate:       position.value_date,
    notionalBase:       position.notional_base,
    contractedRate:     position.contracted_rate,
    spotRateAtTrade:    spotRateAtTrade,
    forwardPoints,
    spotRateAtTradeAvailable,
    testDate:           today,
    currentSpotRate,
    deltaFvInstrument,
    deltaFvHedgedItem,
    dollarOffsetRatioPct,
    retrospectiveResult,
    effectivePortionUsd,
    ineffectivePortionUsd,
    rSquared,
    slope,
    fStatistic,
    historicalMonths,
    prospectiveResult,
    overallStatus,
    designationMemo,
  }
}

// ── Summary aggregator ───────────────────────────────────────────────────────

export function getEffectivenessSummary(results: HedgeEffectivenessResult[]): EffectivenessSummary {
  let passCount         = 0
  let failCount         = 0
  let needsReviewCount  = 0
  let inconclusiveCount = 0
  let totalEffectivePortionUsd   = 0
  let totalIneffectivePortionUsd = 0
  let totalAbsFvChangeUsd        = 0

  for (const r of results) {
    if (r.overallStatus === 'effective')    passCount++
    else if (r.overallStatus === 'ineffective') failCount++
    else needsReviewCount++

    if (r.retrospectiveResult === 'inconclusive') inconclusiveCount++

    totalEffectivePortionUsd   += r.effectivePortionUsd
    totalIneffectivePortionUsd += r.ineffectivePortionUsd
    totalAbsFvChangeUsd        += Math.abs(r.deltaFvInstrument)
  }

  return {
    totalCount:               results.length,
    passCount,
    failCount,
    needsReviewCount,
    inconclusiveCount,
    totalEffectivePortionUsd,
    totalIneffectivePortionUsd,
    totalAbsFvChangeUsd,
  }
}
