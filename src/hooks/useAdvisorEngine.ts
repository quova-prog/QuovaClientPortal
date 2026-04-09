/**
 * Orchestrates the full Advisor pipeline:
 *   1. Fetch 2-year historical rates (Frankfurter timeseries — one request)
 *   2. Run the deterministic risk engine synchronously via useMemo
 *   3. Generate local plain-language analysis without any browser-side AI API call
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useHedgePositions, useHedgePolicy, useFxRates } from '@/hooks/useData'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useEntity } from '@/context/EntityContext'
import { fetchHistoricalTimeseries, type MonthlySnapshot } from '@/lib/frankfurter'
import {
  computeRiskMetrics, rankStrategies, runBacktest,
  type RiskMetrics, type Strategy, type BacktestResult,
} from '@/lib/advisorEngine'
import {
  getAdvisorAnalysis, generateFallbackAnalysis, isConfigured,
  type AiAnalysis,
} from '@/lib/claudeClient'

// Two-year window: today back 24 months
function buildDateRange(): { start: string; end: string } {
  const end   = new Date()
  const start = new Date()
  start.setFullYear(start.getFullYear() - 2)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

export interface AdvisorState {
  riskMetrics:   RiskMetrics | null
  strategies:    Strategy[]
  backtest:      BacktestResult | null
  aiAnalysis:    AiAnalysis | null

  loading:       boolean     // deterministic data not yet ready
  historyLoading: boolean    // historical rates still fetching
  aiLoading:     boolean     // plain-language summary generation in progress
  aiConfigured:  boolean     // false until a server-side AI path exists

  error:         string | null
  refresh:       () => void
}

export function useAdvisorEngine(): AdvisorState {
  const { combinedCoverage, loading: covLoading } = useCombinedCoverage()
  const { positions, loading: posLoading }         = useHedgePositions()
  const { policy, loading: polLoading }            = useHedgePolicy()
  const { ratesMap }                               = useLiveFxRates()
  const { rates: fxRates }                          = useFxRates()
  const { currentEntityId }                        = useEntity()

  const [snapshots, setSnapshots]     = useState<MonthlySnapshot[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError]     = useState<string | null>(null)
  const [refreshTick, setRefreshTick]       = useState(0)

  const [aiAnalysis, setAiAnalysis]   = useState<AiAnalysis | null>(null)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiError, setAiError]         = useState<string | null>(null)
  const aiDoneRef                     = useRef(false)

  // Reset AI when entity changes so it re-runs with new scoped data
  useEffect(() => {
    aiDoneRef.current = false
    setAiAnalysis(null)
  }, [currentEntityId])

  // ── 1. Fetch historical timeseries ──────────────────────
  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    aiDoneRef.current = false
    setAiAnalysis(null)

    const { start, end } = buildDateRange()
    fetchHistoricalTimeseries(start, end)
      .then(data => { if (!cancelled) setSnapshots(data) })
      .catch(e   => { if (!cancelled) setHistoryError(String(e)) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })

    return () => { cancelled = true }
  }, [refreshTick])

  // ── 2. Deterministic engine ──────────────────────────────
  const rates = useMemo(
    () => ({ ...fxRates, ...ratesMap }),
    [fxRates, ratesMap],
  )

  const dataReady = !covLoading && !posLoading && !polLoading && !historyLoading

  const riskMetrics = useMemo<RiskMetrics | null>(() => {
    if (!dataReady || combinedCoverage.length === 0) return null
    return computeRiskMetrics(combinedCoverage, positions, rates, policy, snapshots)
  }, [dataReady, combinedCoverage, positions, rates, policy, snapshots])

  const strategies = useMemo<Strategy[]>(() => {
    if (!riskMetrics) return []
    return rankStrategies(riskMetrics, policy)
  }, [riskMetrics, policy])

  const backtest = useMemo<BacktestResult | null>(() => {
    if (!riskMetrics || snapshots.length < 2) return null
    return runBacktest(snapshots, riskMetrics)
  }, [riskMetrics, snapshots])

  // ── 3. Plain-language analysis (local-only) ────────────────────────────
  useEffect(() => {
    if (!riskMetrics || !backtest || strategies.length === 0) return
    if (aiDoneRef.current) return   // don't re-call on re-renders

    aiDoneRef.current = true
    setAiLoading(true)
    setAiError(null)

    getAdvisorAnalysis(riskMetrics, strategies, backtest)
      .then(a  => setAiAnalysis(a))
      .catch(() => {
        // Defensive fallback, though the local implementation should not fail
        setAiAnalysis(generateFallbackAnalysis(riskMetrics))
        setAiError('Executive summary unavailable - showing estimated insights')
      })
      .finally(() => setAiLoading(false))
  }, [riskMetrics, strategies, backtest])

  return {
    riskMetrics,
    strategies,
    backtest,
    aiAnalysis,
    loading:        !dataReady || !riskMetrics,
    historyLoading,
    aiLoading,
    aiConfigured:   isConfigured,
    error:          historyError ?? aiError,
    refresh:        () => setRefreshTick(t => t + 1),
  }
}
