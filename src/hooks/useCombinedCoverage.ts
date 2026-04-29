import { useMemo } from 'react'
import { useHedgeCoverage, useExposures, useHedgePositions } from './useData'
import { useDerivedExposures, DerivedExposureSource } from './useDerivedExposures'
import { useEntity } from '@/context/EntityContext'

export interface CombinedCoverage {
  // All fields from HedgeCoverage:
  currency_pair: string
  base_currency: string
  quote_currency: string
  net_exposure: number
  total_hedged: number
  coverage_pct: number
  unhedged_amount: number
  earliest_settlement: string
  latest_settlement: string
  // New fields:
  real_exposure: number
  derived_exposure: number
  derived_sources: DerivedExposureSource[]
  source_breakdown: { source: DerivedExposureSource; amount: number; count: number }[]
}

export function useCombinedCoverage(): { combinedCoverage: CombinedCoverage[]; loading: boolean } {
  const { isConsolidated } = useEntity()

  // Consolidated: use DB views + derived CSV exposures (existing behaviour)
  const { coverage: viewCoverage, loading: covLoading } = useHedgeCoverage()
  const { derivedExposures, loading: derLoading } = useDerivedExposures()

  // All hedge positions (needed for derived-only pair coverage in consolidated view)
  const { positions: allPositions } = useHedgePositions()

  // Entity-specific: use entity-filtered raw tables (derived CSV has no entity_id so skip it)
  const { exposures, loading: expLoading } = useExposures()
  const { positions, loading: posLoading } = useHedgePositions()

  // When an entity is selected, compute coverage from filtered raw data
  const entityCoverage = useMemo(() => {
    if (isConsolidated) return null
    const expByPair: Record<string, { net: number; base: string; quote: string }> = {}
    for (const exp of exposures) {
      if (!expByPair[exp.currency_pair]) {
        expByPair[exp.currency_pair] = { net: 0, base: exp.base_currency, quote: exp.quote_currency }
      }
      expByPair[exp.currency_pair].net += exp.direction === 'receivable' ? exp.notional_base : -exp.notional_base
    }
    // Net hedged = |sell − buy| per pair (consistent with v_hedge_coverage and computeHedgeCoverage)
    const sellByPair: Record<string, number> = {}
    const buyByPair: Record<string, number> = {}
    for (const p of positions) {
      if (p.direction === 'sell') {
        sellByPair[p.currency_pair] = (sellByPair[p.currency_pair] ?? 0) + p.notional_base
      } else {
        buyByPair[p.currency_pair] = (buyByPair[p.currency_pair] ?? 0) + p.notional_base
      }
    }
    const hedgedByPair: Record<string, number> = {}
    for (const pair of new Set([...Object.keys(sellByPair), ...Object.keys(buyByPair)])) {
      hedgedByPair[pair] = Math.abs((sellByPair[pair] ?? 0) - (buyByPair[pair] ?? 0))
    }
    return Object.entries(expByPair).map(([pair, { net }]) => {
      const total_hedged = hedgedByPair[pair] ?? 0
      const abs_net = Math.abs(net)
      return {
        org_id: '',
        currency_pair: pair,
        net_exposure: net,
        total_hedged,
        coverage_pct: abs_net > 0 ? Math.min((total_hedged / abs_net) * 100, 999) : 0,
        unhedged_amount: Math.max(abs_net - total_hedged, 0),
      }
    })
  }, [isConsolidated, exposures, positions])

  const coverage = useMemo(
    () => (isConsolidated ? viewCoverage : (entityCoverage ?? [])),
    [isConsolidated, viewCoverage, entityCoverage],
  )
  const loading = isConsolidated
    ? (covLoading || derLoading)
    : (expLoading || posLoading)

  const combinedCoverage = useMemo<CombinedCoverage[]>(() => {
    if (loading) return []

    // Entity view: no derived exposures (CSV data has no entity_id), just real data
    if (!isConsolidated) {
      return coverage.map(c => ({
        currency_pair: c.currency_pair,
        base_currency: (c as any).base_currency ?? c.currency_pair.split('/')[0] ?? '',
        quote_currency: (c as any).quote_currency ?? c.currency_pair.split('/')[1] ?? '',
        net_exposure: c.net_exposure,
        total_hedged: c.total_hedged,
        coverage_pct: c.coverage_pct,
        unhedged_amount: c.unhedged_amount,
        earliest_settlement: '',
        latest_settlement: '',
        real_exposure: c.net_exposure,
        derived_exposure: 0,
        derived_sources: [],
        source_breakdown: [],
      }))
    }

    // Group derived exposures by currency_pair
    const derivedByPair = new Map<string, {
      net: number
      sources: Set<DerivedExposureSource>
      breakdown: Map<DerivedExposureSource, { amount: number; count: number }>
      dates: string[]
    }>()

    for (const exp of derivedExposures) {
      let entry = derivedByPair.get(exp.currency_pair)
      if (!entry) {
        entry = { net: 0, sources: new Set(), breakdown: new Map(), dates: [] }
        derivedByPair.set(exp.currency_pair, entry)
      }
      // receivable = positive contribution, payable = negative
      const signed = exp.direction === 'receivable' ? exp.notional_base : -exp.notional_base
      entry.net += signed
      entry.sources.add(exp.source)
      if (exp.settlement_date) entry.dates.push(exp.settlement_date)
      const bkd = entry.breakdown.get(exp.source)
      if (bkd) {
        bkd.amount += Math.abs(exp.notional_base)
        bkd.count += 1
      } else {
        entry.breakdown.set(exp.source, { amount: Math.abs(exp.notional_base), count: 1 })
      }
    }

    const result: CombinedCoverage[] = []

    // Build set of real coverage pairs for later
    const realPairs = new Set(coverage.map(c => c.currency_pair))

    // Process real coverage entries
    for (const c of coverage) {
      const [baseCcy = '', quoteCcy = ''] = c.currency_pair.split('/')
      const derived = derivedByPair.get(c.currency_pair)
      const derivedNet = derived ? derived.net : 0

      const realExposure = c.net_exposure
      const combinedNet = realExposure + derivedNet

      const newTotalHedged = c.total_hedged
      const newCoveragePct = Math.abs(combinedNet) > 0
        ? Math.min((newTotalHedged / Math.abs(combinedNet)) * 100, 999)
        : 0
      const newUnhedged = Math.max(Math.abs(combinedNet) - newTotalHedged, 0)

      // Settlement date range — merge real dates from HedgeCoverage with derived
      // HedgeCoverage itself doesn't carry earliest/latest, so we start from derived
      const allDates: string[] = derived ? [...derived.dates] : []
      allDates.sort()

      const sourceBreakdown: CombinedCoverage['source_breakdown'] = derived
        ? Array.from(derived.breakdown.entries()).map(([source, v]) => ({ source, ...v }))
        : []

      result.push({
        currency_pair: c.currency_pair,
        base_currency: baseCcy,
        quote_currency: quoteCcy,
        net_exposure: combinedNet,
        total_hedged: newTotalHedged,
        coverage_pct: newCoveragePct,
        unhedged_amount: newUnhedged,
        earliest_settlement: allDates[0] ?? '',
        latest_settlement: allDates[allDates.length - 1] ?? '',
        real_exposure: realExposure,
        derived_exposure: derivedNet,
        derived_sources: derived ? Array.from(derived.sources) : [],
        source_breakdown: sourceBreakdown,
      })
    }

    // Net hedged = |sell − buy| per pair (consistent with v_hedge_coverage)
    const sellByPair2: Record<string, number> = {}
    const buyByPair2: Record<string, number> = {}
    for (const p of allPositions) {
      if (p.direction === 'sell') {
        sellByPair2[p.currency_pair] = (sellByPair2[p.currency_pair] ?? 0) + p.notional_base
      } else {
        buyByPair2[p.currency_pair] = (buyByPair2[p.currency_pair] ?? 0) + p.notional_base
      }
    }
    const hedgedByPair: Record<string, number> = {}
    for (const pair of new Set([...Object.keys(sellByPair2), ...Object.keys(buyByPair2)])) {
      hedgedByPair[pair] = Math.abs((sellByPair2[pair] ?? 0) - (buyByPair2[pair] ?? 0))
    }

    // Add currency pairs that only exist in derived data
    for (const [pair, derived] of derivedByPair.entries()) {
      if (realPairs.has(pair)) continue

      const [baseCcy = '', quoteCcy = ''] = pair.split('/')
      const derivedNet = derived.net
      const dates = [...derived.dates].sort()
      const total_hedged = hedgedByPair[pair] ?? 0
      const abs_net = Math.abs(derivedNet)
      const coverage_pct = abs_net > 0 ? Math.min((total_hedged / abs_net) * 100, 999) : 0
      const unhedged_amount = Math.max(abs_net - total_hedged, 0)

      const sourceBreakdown: CombinedCoverage['source_breakdown'] = Array.from(
        derived.breakdown.entries()
      ).map(([source, v]) => ({ source, ...v }))

      result.push({
        currency_pair: pair,
        base_currency: baseCcy,
        quote_currency: quoteCcy,
        net_exposure: derivedNet,
        total_hedged,
        coverage_pct,
        unhedged_amount,
        earliest_settlement: dates[0] ?? '',
        latest_settlement: dates[dates.length - 1] ?? '',
        real_exposure: 0,
        derived_exposure: derivedNet,
        derived_sources: Array.from(derived.sources),
        source_breakdown: sourceBreakdown,
      })
    }

    return result
  }, [loading, isConsolidated, coverage, derivedExposures, allPositions])

  return { combinedCoverage, loading }
}
