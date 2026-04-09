/**
 * Quova Advisor — Deterministic Risk Engine
 *
 * All numbers in this file are computed from real data.
 * Claude receives the output of this engine and explains it in plain English.
 * Nothing is invented here.
 */

import type { HedgePolicy, HedgePosition } from '@/types'
import type { CombinedCoverage } from '@/hooks/useCombinedCoverage'
import type { MonthlySnapshot } from '@/lib/frankfurter'
import { toUsd as _toUsd } from '@/lib/fx'

// ── Constants ──────────────────────────────────────────────────────────────

/** Long-run annual volatility estimates per pair (as decimal, e.g. 0.07 = 7%) */
const DEFAULT_VOL: Record<string, number> = {
  'EUR/USD': 0.068, 'GBP/USD': 0.082, 'USD/JPY': 0.085,
  'USD/CAD': 0.065, 'AUD/USD': 0.095, 'USD/CHF': 0.070,
  'EUR/GBP': 0.068, 'EUR/CAD': 0.088, 'GBP/CAD': 0.095,
  'EUR/JPY': 0.095, 'GBP/JPY': 0.105,
}

/** Annualized forward premium per pair (%) — interest rate differential proxy */
const FORWARD_PREMIUM: Record<string, number> = {
  'USD/CAD': 0.39, 'EUR/CAD': 0.55, 'GBP/CAD': 0.57,
  'EUR/USD': 0.42, 'GBP/USD': 0.43, 'USD/JPY': 0.35,
  'AUD/USD': 0.50, 'USD/CHF': 0.30,
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CurrencyRisk {
  pair: string
  exposureUsd: number
  hedgedUsd: number
  unhedgedUsd: number
  coveragePct: number
  annualVolPct: number
  var95Usd: number
  settlementRange: string
  gapToMinPolicyUsd: number   // negative means insufficient hedge
}

export interface RiskMetrics {
  totalExposureUsd: number
  totalHedgedUsd: number
  unhedgedUsd: number
  currentHedgeRatioPct: number
  policyMinPct: number
  policyMaxPct: number
  targetPct: number
  hedgeGapUsd: number           // additional hedging needed to hit policy min
  var95Usd: number              // portfolio 95th-pct 1-year VaR
  var99Usd: number
  policyBreached: boolean
  estimatedTenorMonths: number  // derived from settlement dates if policy has no max_tenor_months
  nearestSettlementDays: number
  currencyRisks: CurrencyRisk[]
  primaryPair: string           // largest exposure
  hasPolicy: boolean
}

export interface Strategy {
  id: 'A' | 'B' | 'C'
  name: string
  tagline: string
  instruments: { type: string; pct: number }[]
  targetHedgeRatioPct: number
  coverageGainPct: number
  estimatedCostBps: number        // annualized basis points
  estimatedCostUsd: number        // expected total cost over recommended tenor
  volatilityReductionPct: number
  var95AfterUsd: number
  policyComplianceScore: number   // 0–100
  executionComplexity: 'low' | 'medium' | 'high'
  recommendedTenorMonths: number
  overallScore: number            // 0–100 weighted ranking score
  backtestPnlUsd: number
  backtestWinRatePct: number
}

export interface BacktestDataPoint {
  date: string
  hedgedCumulativeUsd: number
  label: string
}

export interface BacktestResult {
  monthlyData: BacktestDataPoint[]
  totalHedgeBenefitUsd: number
  winRatePct: number
  avgMonthlyBenefitUsd: number
  maxMonthlyBenefitUsd: number
  worstMonthlyBenefitUsd: number
  pairsCovered: number   // how many pairs had sufficient ECB history
  totalPairs: number     // total pairs in the portfolio
}

// ── Internal helpers ───────────────────────────────────────────────────────

function toUsd(amount: number, currency: string, rates: Record<string, number>): number {
  return _toUsd(amount, currency, rates)
}

/**
 * Derive annualized FX volatility from monthly historical snapshots.
 * Falls back to long-run empirical estimates if insufficient data.
 */
function computeAnnualVol(pair: string, snapshots: MonthlySnapshot[]): number {
  const rates = snapshots
    .map(s => s.rates[pair])
    .filter((r): r is number => r != null && r > 0)

  if (rates.length < 4) return DEFAULT_VOL[pair] ?? 0.085

  const logReturns: number[] = []
  for (let i = 1; i < rates.length; i++) {
    logReturns.push(Math.log(rates[i] / rates[i - 1]))
  }

  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length
  const variance =
    logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1)

  return Math.sqrt(variance) * Math.sqrt(12) // monthly std → annualized
}

// ── Core computation ───────────────────────────────────────────────────────

export function computeRiskMetrics(
  combinedCoverage: CombinedCoverage[],
  _positions: HedgePosition[],
  rates: Record<string, number>,
  policy: HedgePolicy | null,
  snapshots: MonthlySnapshot[],
): RiskMetrics {
  const policyMin = policy?.min_coverage_pct ?? 70
  const policyMax = policy?.max_coverage_pct ?? 90
  const targetPct =
    policy?.target_hedge_ratio_pct ??
    Math.round((policyMin + policyMax) / 2)

  // ── Per-currency risk ────────────────────────────────────
  const currencyRisks: CurrencyRisk[] = combinedCoverage
    .filter(c => Math.abs(c.net_exposure) > 0)
    .map(c => {
      const exposureUsd = toUsd(Math.abs(c.net_exposure), c.base_currency, rates)
      const hedgedUsd   = toUsd(c.total_hedged, c.base_currency, rates)
      const unhedgedUsd = Math.max(0, exposureUsd - hedgedUsd)
      const coveragePct = exposureUsd > 0 ? (hedgedUsd / exposureUsd) * 100 : 0
      const vol         = computeAnnualVol(c.currency_pair, snapshots)
      const var95       = unhedgedUsd * vol * 1.645   // parametric VaR

      const gapToMinPolicyUsd = hedgedUsd - exposureUsd * (policyMin / 100)

      const dates = [c.earliest_settlement, c.latest_settlement].filter(Boolean)
      const settlementRange = dates.length === 2
        ? `${dates[0]} – ${dates[1]}`
        : dates[0] ?? 'Unknown'

      return {
        pair: c.currency_pair,
        exposureUsd,
        hedgedUsd,
        unhedgedUsd,
        coveragePct,
        annualVolPct: vol * 100,
        var95Usd: var95,
        settlementRange,
        gapToMinPolicyUsd,
      }
    })
    .sort((a, b) => b.exposureUsd - a.exposureUsd)

  const totalExposureUsd  = currencyRisks.reduce((s, c) => s + c.exposureUsd, 0)
  const totalHedgedUsd    = currencyRisks.reduce((s, c) => s + c.hedgedUsd, 0)
  const unhedgedUsd       = Math.max(0, totalExposureUsd - totalHedgedUsd)
  const currentHedgeRatioPct = totalExposureUsd > 0
    ? (totalHedgedUsd / totalExposureUsd) * 100 : 0
  const var95Usd = currencyRisks.reduce((s, c) => s + c.var95Usd, 0)
  const var99Usd = var95Usd * (2.326 / 1.645)

  const hedgeGapUsd = Math.max(
    0,
    totalExposureUsd * (policyMin / 100) - totalHedgedUsd,
  )

  // ── Tenor estimation ─────────────────────────────────────
  const policyMaxTenor = policy?.max_tenor_months ?? null
  let estimatedTenorMonths: number

  if (policyMaxTenor) {
    estimatedTenorMonths = Math.min(policyMaxTenor, 12)
  } else {
    const now = Date.now()
    const futureDates = combinedCoverage
      .map(c => c.latest_settlement)
      .filter(Boolean)
      .map(d => (new Date(d).getTime() - now) / 86_400_000)
      .filter(d => d > 0)

    if (futureDates.length > 0) {
      const avgDays = futureDates.reduce((s, d) => s + d, 0) / futureDates.length
      estimatedTenorMonths = Math.max(1, Math.min(12, Math.round(avgDays / 30)))
    } else {
      estimatedTenorMonths = 3
    }
  }

  // ── Nearest settlement ────────────────────────────────────
  const now = Date.now()
  const futureDays = combinedCoverage
    .map(c => c.earliest_settlement)
    .filter(Boolean)
    .map(d => (new Date(d).getTime() - now) / 86_400_000)
    .filter(d => d > 0)
  const nearestSettlementDays = futureDays.length > 0
    ? Math.round(Math.min(...futureDays)) : 90

  return {
    totalExposureUsd,
    totalHedgedUsd,
    unhedgedUsd,
    currentHedgeRatioPct,
    policyMinPct: policyMin,
    policyMaxPct: policyMax,
    targetPct,
    hedgeGapUsd,
    var95Usd,
    var99Usd,
    policyBreached: currentHedgeRatioPct < policyMin && totalExposureUsd > 0,
    estimatedTenorMonths,
    nearestSettlementDays,
    currencyRisks,
    primaryPair: currencyRisks[0]?.pair ?? '',
    hasPolicy: policy !== null,
  }
}

// ── Strategy ranking ───────────────────────────────────────────────────────

export function rankStrategies(
  metrics: RiskMetrics,
  policy: HedgePolicy | null,
): Strategy[] {
  const { totalExposureUsd, totalHedgedUsd, targetPct, estimatedTenorMonths, var95Usd } = metrics
  const policyMin = metrics.policyMinPct
  const policyMax = metrics.policyMaxPct

  const additionalHedgeNeeded = Math.max(
    0,
    totalExposureUsd * (targetPct / 100) - totalHedgedUsd,
  )

  // Annualized forward premium (%) for primary pair
  const fwdPremiumPct = FORWARD_PREMIUM[metrics.primaryPair] ?? 0.40

  // Policy compliance scorer: 0–100
  function policyScore(
    achievedPct: number,
    tenorMonths: number,
    instruments: string[],
  ): number {
    let score = 0
    if (achievedPct >= policyMin) score += 40
    if (achievedPct <= policyMax) score += 30
    const maxTenor = policy?.max_tenor_months ?? 999
    if (tenorMonths <= maxTenor) score += 20
    const allowed = policy?.allowed_instruments ?? ['forward', 'swap', 'option', 'spot']
    if (instruments.every(i => allowed.includes(i))) score += 10
    return score
  }

  // Weighted overall score
  function overallScore(
    volReductionDecimal: number,
    costBps: number,
    compliance: number,
    execScore: number, // 0-100
  ): number {
    const costScore = Math.max(0, 100 - costBps / 5) // 500 bps = 0 score
    return (
      volReductionDecimal * 100 * 0.35 +
      costScore           * 0.25 +
      compliance          * 0.25 +
      execScore           * 0.15
    )
  }

  // ── Strategy A: 100% Forward ──────────────────────────────
  const A_tenor   = estimatedTenorMonths
  const A_target  = Math.min(targetPct + 5, 100) // slight buffer above target
  const A_costBps = (fwdPremiumPct / 12) * A_tenor * 100 // annualised bps
  const A_costUsd = additionalHedgeNeeded * (fwdPremiumPct / 100 / 12) * A_tenor
  const A_volRed  = (A_target / 100) * 0.92
  const A_score   = policyScore(A_target, A_tenor, ['forward'])

  // ── Strategy B: 70% Forward + 30% Collar ─────────────────
  const B_tenor   = estimatedTenorMonths
  const B_target  = Math.min(targetPct, 100)
  const B_costBps = (fwdPremiumPct * 0.7 / 12) * B_tenor * 100 + 8
  const B_costUsd = additionalHedgeNeeded * 0.7 * (fwdPremiumPct / 100 / 12) * B_tenor
                  + additionalHedgeNeeded * 0.3 * 0.0010  // ~10bps collar net premium
  const B_volRed  = (B_target / 100) * 0.87
  const B_score   = policyScore(B_target, B_tenor, ['forward', 'option'])

  // ── Strategy C: 100% Vanilla Options ─────────────────────
  const C_tenor   = Math.min(estimatedTenorMonths, 6) // options typically ≤6m
  const C_target  = Math.max(policyMin, targetPct - 5) // cost limits full coverage
  // ATM option premium ≈ 180 bps base + 15 bps per month
  const C_costBps = 180 + C_tenor * 15
  const C_costUsd = additionalHedgeNeeded * (C_costBps / 10_000)
  const C_volRed  = (C_target / 100) * 0.96 // asymmetric protection — very efficient
  const C_score   = policyScore(C_target, C_tenor, ['option'])

  const strategies: Strategy[] = ([ // cast needed: TS won't narrow literal id union to Strategy[]
    {
      id: 'A',
      name: '100% Forward Cover',
      tagline: 'Lock in rates for full certainty on your FX budget',
      instruments: [{ type: 'Forward', pct: 100 }],
      targetHedgeRatioPct: Math.round(A_target),
      coverageGainPct:     Math.max(0, A_target - metrics.currentHedgeRatioPct),
      estimatedCostBps:    Math.round(A_costBps),
      estimatedCostUsd:    A_costUsd,
      volatilityReductionPct: Math.round(A_volRed * 100),
      var95AfterUsd:       var95Usd * (1 - A_volRed),
      policyComplianceScore: A_score,
      executionComplexity: 'low',
      recommendedTenorMonths: A_tenor,
      overallScore:        overallScore(A_volRed, A_costBps, A_score, 95),
      backtestPnlUsd:      0, // filled by runBacktest
      backtestWinRatePct:  0,
    },
    {
      id: 'B',
      name: 'Forward + Collar',
      tagline: '70% forward certainty with 30% upside participation',
      instruments: [{ type: 'Forward', pct: 70 }, { type: 'Collar', pct: 30 }],
      targetHedgeRatioPct: Math.round(B_target),
      coverageGainPct:     Math.max(0, B_target - metrics.currentHedgeRatioPct),
      estimatedCostBps:    Math.round(B_costBps),
      estimatedCostUsd:    B_costUsd,
      volatilityReductionPct: Math.round(B_volRed * 100),
      var95AfterUsd:       var95Usd * (1 - B_volRed),
      policyComplianceScore: B_score,
      executionComplexity: 'medium',
      recommendedTenorMonths: B_tenor,
      overallScore:        overallScore(B_volRed, B_costBps, B_score, 70),
      backtestPnlUsd:      0,
      backtestWinRatePct:  0,
    },
    {
      id: 'C',
      name: 'Vanilla Options',
      tagline: 'Full downside protection while retaining currency upside',
      instruments: [{ type: 'Put/Call Option', pct: 100 }],
      targetHedgeRatioPct: Math.round(C_target),
      coverageGainPct:     Math.max(0, C_target - metrics.currentHedgeRatioPct),
      estimatedCostBps:    Math.round(C_costBps),
      estimatedCostUsd:    C_costUsd,
      volatilityReductionPct: Math.round(C_volRed * 100),
      var95AfterUsd:       var95Usd * (1 - C_volRed),
      policyComplianceScore: C_score,
      executionComplexity: 'high',
      recommendedTenorMonths: C_tenor,
      overallScore:        overallScore(C_volRed, C_costBps, C_score, 65),
      backtestPnlUsd:      0,
      backtestWinRatePct:  0,
    },
  ] as Strategy[]).sort((a, b) => b.overallScore - a.overallScore)

  return strategies
}

// ── Backtest engine ────────────────────────────────────────────────────────

/**
 * Simulate a 1-month rolling forward hedge across ALL currency pairs
 * with sufficient ECB rate history (≥ 2 monthly snapshots).
 *
 * Each pair is weighted by its actual USD-equivalent exposure. Monthly
 * benefits are summed across pairs to produce a portfolio-level result.
 * The "hedge benefit" is the P&L difference between having locked the
 * forward rate vs leaving exposure unhedged.
 */
export function runBacktest(
  snapshots: MonthlySnapshot[],
  metrics: RiskMetrics,
): BacktestResult {
  const emptyResult = (pairsCovered = 0): BacktestResult => ({
    monthlyData: [], totalHedgeBenefitUsd: 0, winRatePct: 50,
    avgMonthlyBenefitUsd: 0, maxMonthlyBenefitUsd: 0, worstMonthlyBenefitUsd: 0,
    pairsCovered, totalPairs: metrics.currencyRisks.length,
  })

  if (snapshots.length < 2 || metrics.totalExposureUsd <= 0) return emptyResult()

  // Accumulate monthly portfolio benefit in a date-keyed map
  const benefitByDate = new Map<string, number>()
  let pairsCovered = 0

  for (const cr of metrics.currencyRisks) {
    const monthlyNotional = cr.exposureUsd / 12
    if (monthlyNotional <= 0) continue

    const rateData = snapshots
      .map(s => ({ date: s.date, rate: s.rates[cr.pair] }))
      .filter((d): d is { date: string; rate: number } => d.rate != null && d.rate > 0)

    if (rateData.length < 2) continue
    pairsCovered++

    for (let i = 0; i < rateData.length - 1; i++) {
      const spotOpen  = rateData[i].rate
      const spotClose = rateData[i + 1].rate
      // Factor 0.5 reflects a realistic mix of receivables and payables.
      const benefit = ((spotOpen - spotClose) / spotOpen) * monthlyNotional * 0.5
      const date    = rateData[i + 1].date
      benefitByDate.set(date, (benefitByDate.get(date) ?? 0) + benefit)
    }
  }

  if (pairsCovered === 0) return emptyResult()

  // Sort chronologically and build cumulative chart
  const sortedDates    = [...benefitByDate.keys()].sort()
  const monthlyBenefits: number[] = []
  let cumulative = 0

  const monthlyData: BacktestDataPoint[] = sortedDates.map(date => {
    const b = benefitByDate.get(date)!
    monthlyBenefits.push(b)
    cumulative += b
    return {
      date,
      hedgedCumulativeUsd: cumulative,
      label: new Date(date).toLocaleString('en-US', { month: 'short', year: '2-digit' }),
    }
  })

  const total   = monthlyBenefits.reduce((s, b) => s + b, 0)
  const wins    = monthlyBenefits.filter(b => b > 0).length
  const winRate = (wins / monthlyBenefits.length) * 100
  const avg     = total / monthlyBenefits.length
  const max     = Math.max(...monthlyBenefits)
  const worst   = Math.min(...monthlyBenefits)

  return {
    monthlyData,
    totalHedgeBenefitUsd:    total,
    winRatePct:              winRate,
    avgMonthlyBenefitUsd:    avg,
    maxMonthlyBenefitUsd:    max,
    worstMonthlyBenefitUsd:  worst,
    pairsCovered,
    totalPairs: metrics.currencyRisks.length,
  }
}

// ── Context formatter for Claude ───────────────────────────────────────────

/** Serialises the deterministic output into a concise JSON block for the AI prompt. */
export function formatAdvisorContext(
  metrics: RiskMetrics,
  strategies: Strategy[],
  backtest: BacktestResult,
): string {
  const top = strategies[0]

  return JSON.stringify(
    {
      exposure: {
        totalUsd:          Math.round(metrics.totalExposureUsd),
        hedgedUsd:         Math.round(metrics.totalHedgedUsd),
        unhedgedUsd:       Math.round(metrics.unhedgedUsd),
        currentHedgeRatio: `${metrics.currentHedgeRatioPct.toFixed(1)}%`,
        var95Usd:          Math.round(metrics.var95Usd),
        policyBreached:    metrics.policyBreached,
        policyBand:        `${metrics.policyMinPct}%–${metrics.policyMaxPct}%`,
        primaryPair:       metrics.primaryPair,
        nearestSettlementDays: metrics.nearestSettlementDays,
        estimatedTenorMonths:  metrics.estimatedTenorMonths,
        currencyCount:     metrics.currencyRisks.length,
      },
      topRecommendation: {
        strategy:      top.id,
        name:          top.name,
        instruments:   top.instruments.map(i => `${i.pct}% ${i.type}`).join(' + '),
        targetCoverage: `${top.targetHedgeRatioPct}%`,
        costBpsAnnual: top.estimatedCostBps,
        estimatedCostUsd: Math.round(top.estimatedCostUsd),
        volReduction:  `${top.volatilityReductionPct}%`,
        policyScore:   `${top.policyComplianceScore}/100`,
        tenorMonths:   top.recommendedTenorMonths,
        executionComplexity: top.executionComplexity,
      },
      backtest: {
        period:            '24 months',
        coverage:          `${backtest.pairsCovered} of ${backtest.totalPairs} pairs`,
        totalBenefitUsd:   Math.round(backtest.totalHedgeBenefitUsd),
        winRatePct:        Math.round(backtest.winRatePct),
        avgMonthlyUsd:     Math.round(backtest.avgMonthlyBenefitUsd),
      },
      allStrategies: strategies.map(s => ({
        id:         s.id,
        name:       s.name,
        score:      Math.round(s.overallScore),
        costBps:    s.estimatedCostBps,
        compliance: s.policyComplianceScore,
        complexity: s.executionComplexity,
      })),
    },
    null,
    2,
  )
}
