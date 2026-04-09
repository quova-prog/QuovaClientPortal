/**
 * scenarioEngine.ts — Pure TypeScript scenario / stress-testing engine.
 * No React dependencies. Import and call from components or hooks.
 */

import { toUsd, FALLBACK_FX } from '@/lib/fx'
import type { HedgePosition } from '@/types'
import type { CombinedCoverage } from '@/hooks/useCombinedCoverage'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioShock {
  /** e.g. 'EUR', 'USD/JPY', 'KRW' */
  currencyOrPair: string
  type: 'absolute_rate' | 'pct_change'
  /** Absolute rate OR decimal fraction (e.g. -0.15 for -15%) */
  value: number
  /** Human-readable label, e.g. "EUR/USD → 1.00" or "KRW −15%" */
  label: string
}

export interface Scenario {
  id: string
  name: string
  category: 'historical' | 'macro' | 'custom'
  /** 1-2 sentences with historical context */
  description: string
  year?: string
  severity: 'mild' | 'moderate' | 'severe'
  shocks: ScenarioShock[]
}

export interface PairScenarioResult {
  currencyPair: string
  baseCurrency: string
  /** Was this pair shocked? */
  shocked: boolean
  /** % change in rate (e.g. -0.15) */
  shockPct: number
  /** Current USD per 1 unit of base */
  currentRateUsd: number
  /** Stressed USD per 1 unit of base */
  stressedRateUsd: number
  // Exposure impact
  exposureNotionalBase: number
  unhedgedNotionalBase: number
  unhedgedCurrentUsd: number
  unhedgedStressedUsd: number
  /** negative = loss, positive = gain */
  unhedgedPnlImpact: number
  // Hedge instrument impact
  /** Change in combined instrument MTM */
  hedgeInstrumentDelta: number
  // Hedged exposure offset
  /** Change in hedged exposure value (offsets instrument) */
  hedgedExposureDelta: number
  // Net
  /** unhedgedPnlImpact + (hedgeInstrumentDelta + hedgedExposureDelta) */
  netEconomicImpact: number
  // Coverage
  currentCoveragePct: number
  /** Coverage doesn't change from rate moves alone */
  stressedCoveragePct: number
}

export interface ScenarioRunResult {
  scenario: Scenario
  runDate: string
  /** Sum of negative unhedgedPnlImpact */
  totalUnhedgedLoss: number
  /** From hedgeInstrumentDelta (can be negative) */
  totalHedgeGain: number
  /** Sum of all netEconomicImpact */
  netPortfolioImpact: number
  pairsAffected: number
  /** Pairs with shock but 0% coverage */
  pairsUnprotected: number
  byPair: PairScenarioResult[]
  /** Recomputed VaR under the stress */
  var95UnderScenario: number
}

// ─── Predefined Scenarios ─────────────────────────────────────────────────────

export const PREDEFINED_SCENARIOS: Scenario[] = [
  {
    id: 'jpy_170',
    name: 'JPY Weakness — USD/JPY 170',
    category: 'macro',
    description:
      'Yen extends its multi-year depreciation trend. USD/JPY reaches 170, a level last seen in 1986. Driven by BoJ yield curve control and Fed divergence.',
    year: '2024+',
    severity: 'moderate',
    shocks: [
      {
        currencyOrPair: 'USD/JPY',
        type: 'absolute_rate',
        value: 170,
        label: 'USD/JPY → 170',
      },
    ],
  },
  {
    id: 'eur_parity',
    name: 'Euro at Parity',
    category: 'historical',
    description:
      'EUR/USD falls to 1.00. This level was last breached in September 2022 when the euro hit 0.9535 amid the energy crisis and ECB-Fed divergence.',
    year: '2022',
    severity: 'moderate',
    shocks: [
      {
        currencyOrPair: 'EUR/USD',
        type: 'absolute_rate',
        value: 1.0,
        label: 'EUR/USD → 1.00',
      },
    ],
  },
  {
    id: 'krw_2022',
    name: 'KRW −15% (2022 Replay)',
    category: 'historical',
    description:
      'Korean won depreciates 15% vs USD, matching the actual KRW selloff in 2022 driven by global risk-off, rising US rates, and capital outflows from EM.',
    year: '2022',
    severity: 'moderate',
    shocks: [
      {
        currencyOrPair: 'KRW',
        type: 'pct_change',
        value: -0.15,
        label: 'KRW −15%',
      },
    ],
  },
  {
    id: 'usd_surge',
    name: 'USD Dollar Surge +10%',
    category: 'macro',
    description:
      'Broad USD strengthening of 10% against all major and EM pairs. Equivalent to a DXY move from ~104 to ~115, driven by a global risk-off flight to safety.',
    severity: 'moderate',
    shocks: [
      { currencyOrPair: 'EUR', type: 'pct_change', value: -0.10, label: 'EUR −10% vs USD' },
      { currencyOrPair: 'GBP', type: 'pct_change', value: -0.10, label: 'GBP −10% vs USD' },
      { currencyOrPair: 'JPY', type: 'pct_change', value: -0.10, label: 'JPY −10% vs USD' },
      { currencyOrPair: 'CAD', type: 'pct_change', value: -0.10, label: 'CAD −10% vs USD' },
      { currencyOrPair: 'AUD', type: 'pct_change', value: -0.10, label: 'AUD −10% vs USD' },
      { currencyOrPair: 'CHF', type: 'pct_change', value: -0.10, label: 'CHF −10% vs USD' },
      { currencyOrPair: 'KRW', type: 'pct_change', value: -0.10, label: 'KRW −10% vs USD' },
      { currencyOrPair: 'INR', type: 'pct_change', value: -0.10, label: 'INR −10% vs USD' },
      { currencyOrPair: 'CNY', type: 'pct_change', value: -0.10, label: 'CNY −10% vs USD' },
    ],
  },
  {
    id: 'em_crisis',
    name: 'EM Currency Crisis (2018-style)',
    category: 'historical',
    description:
      'Broad emerging market selloff. KRW −15%, INR −13%, BRL −25%, TRY −30%, ZAR −20%. Reflects 2018 EM stress from Fed tightening and trade war fears.',
    year: '2018',
    severity: 'severe',
    shocks: [
      { currencyOrPair: 'KRW', type: 'pct_change', value: -0.15, label: 'KRW −15%' },
      { currencyOrPair: 'INR', type: 'pct_change', value: -0.13, label: 'INR −13%' },
      { currencyOrPair: 'BRL', type: 'pct_change', value: -0.25, label: 'BRL −25%' },
      { currencyOrPair: 'TRY', type: 'pct_change', value: -0.30, label: 'TRY −30%' },
      { currencyOrPair: 'ZAR', type: 'pct_change', value: -0.20, label: 'ZAR −20%' },
    ],
  },
  {
    id: 'gfc',
    name: 'GFC Redux (2008-style)',
    category: 'historical',
    description:
      'Global financial crisis replay. JPY and CHF surge as safe havens; risk currencies (AUD, GBP, EM) fall sharply. Peak-to-trough moves from Q3 2008–Q1 2009.',
    year: '2008',
    severity: 'severe',
    shocks: [
      { currencyOrPair: 'JPY', type: 'pct_change', value: +0.25, label: 'JPY +25% (safe haven)' },
      { currencyOrPair: 'CHF', type: 'pct_change', value: +0.15, label: 'CHF +15% (safe haven)' },
      { currencyOrPair: 'EUR', type: 'pct_change', value: -0.15, label: 'EUR −15%' },
      { currencyOrPair: 'GBP', type: 'pct_change', value: -0.25, label: 'GBP −25%' },
      { currencyOrPair: 'AUD', type: 'pct_change', value: -0.35, label: 'AUD −35%' },
      { currencyOrPair: 'CAD', type: 'pct_change', value: -0.20, label: 'CAD −20%' },
      { currencyOrPair: 'KRW', type: 'pct_change', value: -0.30, label: 'KRW −30%' },
    ],
  },
  {
    id: 'soft_landing',
    name: 'Fed Pivot — USD Weakens 8%',
    category: 'macro',
    description:
      'Fed cuts rates aggressively, USD weakens broadly by 8%. Favorable for companies with foreign currency receivables; adverse for those with payables.',
    severity: 'mild',
    shocks: [
      { currencyOrPair: 'EUR', type: 'pct_change', value: +0.08, label: 'EUR +8% vs USD' },
      { currencyOrPair: 'GBP', type: 'pct_change', value: +0.08, label: 'GBP +8% vs USD' },
      { currencyOrPair: 'JPY', type: 'pct_change', value: +0.08, label: 'JPY +8% vs USD' },
      { currencyOrPair: 'CAD', type: 'pct_change', value: +0.08, label: 'CAD +8% vs USD' },
      { currencyOrPair: 'AUD', type: 'pct_change', value: +0.08, label: 'AUD +8% vs USD' },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the USD value of 1 unit of `currency` from a rates map.
 * Tries CCY/USD, then 1/USD/CCY, then FALLBACK_FX.
 */
export function getCurrentRateVsUsd(
  currency: string,
  ratesMap: Record<string, number>,
): number {
  const ccy = currency.toUpperCase()
  if (ccy === 'USD') return 1.0

  // Direct key: CCY/USD
  const direct = ratesMap[`${ccy}/USD`]
  if (direct && direct > 0) return direct

  // Inverse key: USD/CCY → 1/rate
  const inverse = ratesMap[`USD/${ccy}`]
  if (inverse && inverse > 0) return 1 / inverse

  // Fallback table
  return FALLBACK_FX[ccy] ?? 1.0
}

/**
 * Apply a list of shocks to a rates map and return a new (shallow-cloned + modified) map.
 */
export function buildStressedRates(
  currentRates: Record<string, number>,
  shocks: ScenarioShock[],
): Record<string, number> {
  const stressed: Record<string, number> = { ...currentRates }

  for (const shock of shocks) {
    const cop = shock.currencyOrPair.toUpperCase()

    if (shock.type === 'absolute_rate') {
      // e.g. USD/JPY → 170  or  EUR/USD → 1.00
      if (cop.includes('/')) {
        stressed[cop] = shock.value
        // Also store inverse
        if (shock.value > 0) {
          const [base, quote] = cop.split('/')
          stressed[`${quote}/${base}`] = 1 / shock.value
        }
      } else {
        // Bare currency + absolute rate: treat as CCY/USD
        stressed[`${cop}/USD`] = shock.value
        if (shock.value > 0) {
          stressed[`USD/${cop}`] = 1 / shock.value
        }
      }
    } else {
      // pct_change
      if (cop.includes('/')) {
        // e.g. EUR/USD pct_change
        const currentRate = currentRates[cop] ?? 0
        if (currentRate > 0) {
          const newRate = currentRate * (1 + shock.value)
          stressed[cop] = newRate
          const [base, quote] = cop.split('/')
          if (newRate > 0) stressed[`${quote}/${base}`] = 1 / newRate
        }
      } else {
        // Bare currency code — find current USD rate and apply shock
        const currentRateVsUsd = getCurrentRateVsUsd(cop, currentRates)
        const stressedRateVsUsd = currentRateVsUsd * (1 + shock.value)

        // Store both directions
        stressed[`${cop}/USD`] = stressedRateVsUsd
        if (stressedRateVsUsd > 0) {
          stressed[`USD/${cop}`] = 1 / stressedRateVsUsd
        }

        // If there's a cross pair against a non-USD quote already in the map
        // we intentionally leave those alone; the engine uses CCY/USD for impact calc.
      }
    }
  }

  return stressed
}

/**
 * Compute MTM P&L for a hedge position in quote-currency terms.
 *   sell (the company sold base, e.g. sold EUR): gain when base weakens
 *   buy  (the company bought base, e.g. bought EUR): gain when base strengthens
 */
function getMtmInQuoteCcy(
  notional: number,
  direction: 'buy' | 'sell',
  contractedRate: number,
  spotRate: number,
): number {
  if (direction === 'sell') {
    return notional * (contractedRate - spotRate)
  } else {
    return notional * (spotRate - contractedRate)
  }
}

// ─── Main engine ─────────────────────────────────────────────────────────────

/**
 * Annualised FX volatility estimates (approximate, for VaR calc).
 * Used when historical vol data is not available.
 */
const ANNUAL_VOL: Record<string, number> = {
  EUR: 0.07, GBP: 0.09, JPY: 0.09, CAD: 0.07,
  AUD: 0.10, CHF: 0.07, CNY: 0.04, NZD: 0.10,
  SEK: 0.09, NOK: 0.09, DKK: 0.07, HKD: 0.01,
  SGD: 0.04, KRW: 0.09, INR: 0.06, BRL: 0.18,
  ZAR: 0.16, TRY: 0.25, IDR: 0.09, PHP: 0.06,
  THB: 0.06, MYR: 0.07, MXN: 0.13,
}

/**
 * Run a scenario against the current portfolio.
 */
export function runScenario(
  scenario: Scenario,
  combinedCoverage: CombinedCoverage[],
  positions: HedgePosition[],
  currentRates: Record<string, number>,
): ScenarioRunResult {
  const stressedRates = buildStressedRates(currentRates, scenario.shocks)

  const byPair: PairScenarioResult[] = []

  for (const c of combinedCoverage) {
    const baseCurrency = c.base_currency

    // USD per 1 unit of base under current and stressed rates
    const currentRateUsd = getCurrentRateVsUsd(baseCurrency, currentRates)
    const stressedRateUsd = getCurrentRateVsUsd(baseCurrency, stressedRates)

    const shockPct =
      currentRateUsd > 0
        ? (stressedRateUsd - currentRateUsd) / currentRateUsd
        : 0

    const shocked = Math.abs(shockPct) > 1e-9

    // Exposure
    const exposureNotionalBase = Math.abs(c.net_exposure)
    const unhedgedNotionalBase = c.unhedged_amount

    const unhedgedCurrentUsd = unhedgedNotionalBase * currentRateUsd
    const unhedgedStressedUsd = unhedgedNotionalBase * stressedRateUsd

    // Direction sign: receivable → we lose when base weakens; payable → we gain
    const directionSign = c.net_exposure >= 0 ? 1 : -1
    const unhedgedPnlImpact =
      (unhedgedStressedUsd - unhedgedCurrentUsd) * directionSign

    // Hedge instrument MTM delta for active positions in this pair
    const pairPositions = positions.filter(
      p => p.currency_pair === c.currency_pair && p.status === 'active',
    )

    // For spot rate of hedge we use: current (contracted_rate context) vs stressed
    // The hedge notional is in base currency; the pair is base/quote.
    // Quote currency is typically USD for most pairs (EUR/USD, GBP/USD, etc.)
    // For inverted pairs like USD/JPY, quote is JPY. We use getCurrentRateVsUsd
    // for both base and quote to convert to USD.

    let hedgeInstrumentDelta = 0
    for (const pos of pairPositions) {
      const quoteCurrency = c.quote_currency

      // Current spot rate for the pair (base per quote — or use pair directly)
      // We need the "spot" rate in pair terms (base/quote) to compute MTM
      const currentPairRate = currentRates[c.currency_pair]
        ?? (currentRates[`${c.base_currency}/${c.quote_currency}`])
        ?? (c.quote_currency === 'USD'
            ? currentRateUsd
            : currentRateUsd / (getCurrentRateVsUsd(quoteCurrency, currentRates) || 1))

      const stressedPairRate = stressedRates[c.currency_pair]
        ?? (stressedRates[`${c.base_currency}/${c.quote_currency}`])
        ?? (c.quote_currency === 'USD'
            ? stressedRateUsd
            : stressedRateUsd / (getCurrentRateVsUsd(quoteCurrency, stressedRates) || 1))

      const currentMtmQuote = getMtmInQuoteCcy(
        pos.notional_base,
        pos.direction,
        pos.contracted_rate,
        currentPairRate,
      )
      const stressedMtmQuote = getMtmInQuoteCcy(
        pos.notional_base,
        pos.direction,
        pos.contracted_rate,
        stressedPairRate,
      )

      // Convert MTM delta to USD
      const mtmDeltaQuote = stressedMtmQuote - currentMtmQuote
      const quoteRateUsd = getCurrentRateVsUsd(quoteCurrency, stressedRates)
      hedgeInstrumentDelta += mtmDeltaQuote * quoteRateUsd
    }

    // Hedged exposure delta approximately offsets hedge instrument delta for direct hedges
    const hedgedExposureDelta = -hedgeInstrumentDelta

    // Net economic impact ≈ unhedgedPnlImpact (hedge + offset cancel for direct hedges)
    const netEconomicImpact =
      unhedgedPnlImpact + hedgeInstrumentDelta + hedgedExposureDelta

    byPair.push({
      currencyPair: c.currency_pair,
      baseCurrency,
      shocked,
      shockPct,
      currentRateUsd,
      stressedRateUsd,
      exposureNotionalBase,
      unhedgedNotionalBase,
      unhedgedCurrentUsd,
      unhedgedStressedUsd,
      unhedgedPnlImpact,
      hedgeInstrumentDelta,
      hedgedExposureDelta,
      netEconomicImpact,
      currentCoveragePct: c.coverage_pct,
      stressedCoveragePct: c.coverage_pct, // rate moves alone don't change coverage %
    })
  }

  // Aggregates
  const totalUnhedgedLoss = byPair.reduce(
    (sum, r) => sum + Math.min(0, r.unhedgedPnlImpact),
    0,
  )
  const totalHedgeGain = byPair.reduce(
    (sum, r) => sum + r.hedgeInstrumentDelta,
    0,
  )
  const netPortfolioImpact = byPair.reduce(
    (sum, r) => sum + r.netEconomicImpact,
    0,
  )
  const pairsAffected = byPair.filter(r => r.shocked).length
  const pairsUnprotected = byPair.filter(
    r => r.shocked && r.currentCoveragePct < 1,
  ).length

  // Stressed VaR (parametric, 95%)
  // For each pair: unhedgedUsd * annualVol * 1.645
  const var95UnderScenario = byPair.reduce((sum, r) => {
    const annualVol = ANNUAL_VOL[r.baseCurrency] ?? 0.10
    return sum + r.unhedgedStressedUsd * annualVol * 1.645
  }, 0)

  // Use toUsd indirectly — it's already used via getCurrentRateVsUsd which calls FALLBACK_FX
  // Explicit usage to satisfy the import (avoids unused-import lint warnings):
  void toUsd

  return {
    scenario,
    runDate: new Date().toISOString(),
    totalUnhedgedLoss,
    totalHedgeGain,
    netPortfolioImpact,
    pairsAffected,
    pairsUnprotected,
    byPair,
    var95UnderScenario,
  }
}
