/**
 * HedgeEffectivenessPanel
 *
 * Comprehensive hedge effectiveness testing UI under ASC 815 / IFRS 9.
 * Displays retrospective dollar-offset tests and prospective regression
 * results per hedge position, with XLSX audit report export.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown, ChevronRight, Download, AlertTriangle,
  CheckCircle, XCircle, Clock, Info,
} from 'lucide-react'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'
import {
  computeEffectiveness,
  getEffectivenessSummary,
  type HedgeEffectivenessResult,
} from '@/lib/hedgeEffectiveness'
import type { HedgePosition } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type AccountingStandard = 'ASC 815' | 'IFRS 9'

interface HistoricalRateRow {
  date: string
  rate: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtUsd(n: number): string {
  return formatCurrency(Math.abs(n), 'USD', true)
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: HedgeEffectivenessResult['overallStatus'] }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    effective:    { label: 'Effective',    bg: '#0d2b1d', color: '#10b981' },
    needs_review: { label: 'Needs Review', bg: '#2b1d06', color: '#f59e0b' },
    ineffective:  { label: 'Ineffective',  bg: '#2b0d0d', color: '#ef4444' },
  }
  const s = map[status]
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '0.15rem 0.5rem', borderRadius: 4,
      fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.02em',
    }}>
      {s.label}
    </span>
  )
}

function ResultBadge({ result }: {
  result: 'pass' | 'fail' | 'inconclusive' | 'insufficient_data'
}) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    pass:              { label: 'PASS', bg: '#0d2b1d', color: '#10b981' },
    fail:              { label: 'FAIL', bg: '#2b0d0d', color: '#ef4444' },
    inconclusive:      { label: 'N/A',  bg: '#1a1a2e', color: '#8b8b9f' },
    insufficient_data: { label: 'N/A',  bg: '#1a1a2e', color: '#8b8b9f' },
  }
  const s = map[result] ?? map.inconclusive
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '0.15rem 0.45rem', borderRadius: 4,
      fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em',
    }}>
      {s.label}
    </span>
  )
}

// ── XLSX export ───────────────────────────────────────────────────────────────

async function exportAuditReport(
  results: HedgeEffectivenessResult[],
  standard: AccountingStandard,
): Promise<void> {
  const ExcelJS = await import('exceljs')
  const { saveAs } = await import('file-saver')
  const wb = new ExcelJS.Workbook()
  const today = new Date().toISOString().split('T')[0]

  // Sheet 1: Summary
  const summ = getEffectivenessSummary(results)
  const ws1 = wb.addWorksheet('Effectiveness Summary')
  const summaryRows: (string | number)[][] = [
    ['Quova – Hedge Effectiveness Audit Report'],
    [`Generated: ${new Date().toLocaleString()}`, `Standard: ${standard}`],
    [],
    ['Metric', 'Value'],
    ['Test Date', today],
    ['Total Hedges Tested', summ.totalCount],
    ['Effective', summ.passCount],
    ['Needs Review', summ.needsReviewCount],
    ['Ineffective', summ.failCount],
    ['Inconclusive (trivial movement)', summ.inconclusiveCount],
    ['Total Effective Portion (OCI, USD)', summ.totalEffectivePortionUsd.toFixed(2)],
    ['Total Ineffectiveness to P&L (USD)', summ.totalIneffectivePortionUsd.toFixed(2)],
    ['Total |ΔFV| Change (USD)', summ.totalAbsFvChangeUsd.toFixed(2)],
  ]
  summaryRows.forEach(row => ws1.addRow(row))

  // Sheet 2: Test Results
  const ws2 = wb.addWorksheet('Test Results')
  const testHeaders = [
    'Reference #', 'Currency Pair', 'Direction', 'Instrument', 'Hedge Type',
    'Notional (base)', 'Maturity Date', 'Spot at Trade', 'Contracted Rate (Fwd)',
    'Forward Points', 'Current Rate',
    'ΔFV Instrument (USD)', 'ΔFV Hedged Item (USD)', 'Dollar-Offset %',
    'Retro Result', 'R²', 'Slope', 'F-Stat', 'Prosp. Result',
    'Effective Portion USD', 'Ineffective to P&L USD', 'Overall Status',
  ]
  ws2.addRow(testHeaders)
  results.forEach(r => {
    ws2.addRow([
      r.referenceNumber, r.currencyPair, r.direction, r.instrumentType, r.hedgeType,
      r.notionalBase, r.maturityDate,
      r.spotRateAtTrade.toFixed(6), r.contractedRate.toFixed(6),
      r.forwardPoints.toFixed(6), r.currentSpotRate.toFixed(6),
      r.deltaFvInstrument.toFixed(2), r.deltaFvHedgedItem.toFixed(2),
      r.dollarOffsetRatioPct.toFixed(2),
      r.retrospectiveResult.toUpperCase(),
      r.rSquared !== null ? r.rSquared.toFixed(4) : 'N/A',
      r.slope !== null ? r.slope.toFixed(4) : 'N/A',
      r.fStatistic !== null ? r.fStatistic.toFixed(2) : 'N/A',
      r.prospectiveResult.toUpperCase(),
      r.effectivePortionUsd.toFixed(2),
      r.ineffectivePortionUsd.toFixed(2),
      r.overallStatus.toUpperCase(),
    ])
  })

  // Sheet 3: Designation Memos
  const ws3 = wb.addWorksheet('Designation Memos')
  const memoHeaders = [
    'Reference #', 'Currency Pair', 'Hedging Relationship', 'Risk Being Hedged',
    'Hedging Instrument', 'Hedged Item', 'Assessment Method', 'Accounting Standard',
    'Designation Date', 'Maturity Date',
  ]
  ws3.addRow(memoHeaders)
  results.forEach(r => {
    ws3.addRow([
      r.referenceNumber, r.currencyPair,
      r.designationMemo.hedgingRelationship,
      r.designationMemo.riskBeingHedged,
      r.designationMemo.hedgingInstrument,
      r.designationMemo.hedgedItem,
      r.designationMemo.assessmentMethod,
      standard,
      r.designationDate, r.maturityDate,
    ])
  })

  // Sheet 4: Methodology Notes
  const stdRef = standard === 'ASC 815'
    ? 'ASC 815-20-35-2'
    : 'IFRS 9 B6.4.1–B6.4.17'
  const ws4 = wb.addWorksheet('Methodology Notes')
  const methodNotes: (string | number)[][] = [
    ['Quova – Hedge Effectiveness Methodology Notes'],
    [],
    ['Section', 'Description'],
    ['Standard', standard],
    ['Standard Reference', stdRef],
    ['Retrospective Test Method', 'Dollar-Offset Method'],
    ['Retrospective Test Description',
      'Compares the change in fair value (ΔFV) of the hedging instrument to the change in fair value ' +
      'of the hedged item since inception. A ratio of 80%–125% indicates high effectiveness.'],
    ['Prospective Test Method', 'Linear Regression Analysis'],
    ['Prospective Test Description',
      'Regresses monthly changes in the hedging instrument fair value against monthly changes in the ' +
      'hedged item fair value using historical FX rate data. R² ≥ 0.80 and slope between -0.80 and -1.25 ' +
      'indicate prospective effectiveness.'],
    ['Effectiveness Range', '80%–125% (dollar-offset); R² ≥ 0.80, slope -0.80 to -1.25 (regression)'],
    ['ΔFV Instrument Calculation (sell)',
      'FV_instrument = (contracted_rate − current_spot_rate) × notional_base, converted to USD'],
    ['ΔFV Instrument Calculation (buy)',
      'FV_instrument = (current_spot_rate − contracted_rate) × notional_base, converted to USD'],
    ['Hedged Item', 'Hypothetical derivative method (ASC 815-20-25-3): ΔFV_hedged_item = (spot_at_trade − current_spot) × notional, valued independently from the hedging instrument using spot-to-spot change'],
    ['Effective Portion (OCI)', 'min(|ΔFV_instrument|, |ΔFV_hedged_item|) — recorded in Other Comprehensive Income'],
    ['Ineffective Portion (P&L)', 'max(0, |ΔFV_instrument| − |ΔFV_hedged_item|) — recorded in Earnings'],
    ['Data Source – Current Rates', 'Frankfurter ECB API (refreshed every 5 minutes)'],
    ['Data Source – Historical Rates', 'fx_rates table (populated by live rate feed)'],
    ['Disclaimer',
      'This analysis is for informational purposes only. All effectiveness tests must be reviewed ' +
      'by a qualified accountant before inclusion in financial statements.'],
  ]
  methodNotes.forEach(row => ws4.addRow(row))

  const buffer = await wb.xlsx.writeBuffer()
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `hedge_effectiveness_audit_${today}.xlsx`)
}

// ── Expanded row detail ───────────────────────────────────────────────────────

function ExpandedDetail({
  result,
  standard,
}: {
  result: HedgeEffectivenessResult
  standard: AccountingStandard
}) {
  const stdRef = standard === 'ASC 815' ? 'ASC 815-20-55-1' : 'IFRS 9 B6.4.1'
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '0.875rem 1rem',
    marginBottom: '0.75rem',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '0.25rem',
  }
  const valueStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    color: 'var(--text-primary)',
    lineHeight: 1.5,
  }

  return (
    <div style={{ padding: '0.75rem 1.25rem 1rem', background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>

        {/* Formal Designation Memo */}
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
          <div style={{ ...labelStyle, marginBottom: '0.5rem' }}>
            Formal Hedge Designation Memo — {stdRef}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem' }}>
            {([
              ['Hedging Relationship', result.designationMemo.hedgingRelationship],
              ['Risk Being Hedged',    result.designationMemo.riskBeingHedged],
              ['Hedging Instrument',   result.designationMemo.hedgingInstrument],
              ['Hedged Item',          result.designationMemo.hedgedItem],
              ['Assessment Method',    result.designationMemo.assessmentMethod],
              ['Accounting Standard',  standard],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k}>
                <div style={{ ...labelStyle, fontSize: '0.65rem' }}>{k}</div>
                <div style={{ ...valueStyle, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Retrospective Test */}
        <div style={cardStyle}>
          <div style={labelStyle}>Retrospective Dollar-Offset Test</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[
              ['Spot at Trade',         result.spotRateAtTrade.toFixed(6)],
              ['Contracted Rate (Fwd)', result.contractedRate.toFixed(6)],
              ['Forward Points',        (result.forwardPoints >= 0 ? '+' : '') + result.forwardPoints.toFixed(6)],
              ['Current Spot Rate',     result.currentSpotRate.toFixed(6)],
              ['ΔFV Instrument (USD)',  (result.deltaFvInstrument >= 0 ? '+' : '') + fmtUsd(result.deltaFvInstrument)],
              ['ΔFV Hedged Item (USD)', (result.deltaFvHedgedItem >= 0 ? '+' : '') + fmtUsd(result.deltaFvHedgedItem)],
              ['Dollar-Offset Ratio',  fmt(result.dollarOffsetRatioPct) + '%'],
              ['Pass Range',           '80% – 125%'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.375rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Result</span>
              <ResultBadge result={result.retrospectiveResult} />
            </div>
            {!result.spotRateAtTradeAvailable && (
              <div style={{ marginTop: '0.25rem', padding: '0.375rem 0.5rem', background: '#1a1a2e', borderRadius: 4, fontSize: '0.72rem', color: '#8b8b9f' }}>
                Spot rate at trade not recorded — falling back to contracted rate (no basis differential).
              </div>
            )}
          </div>
        </div>

        {/* Prospective Regression */}
        <div style={cardStyle}>
          <div style={labelStyle}>Prospective Regression (OLS)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[
              ['Data Points (months)', result.historicalMonths.toString()],
              ['Minimum Required',     '8 months'],
              ['R²',                   result.rSquared !== null ? result.rSquared.toFixed(4) : 'N/A'],
              ['Slope (β)',             result.slope !== null ? result.slope.toFixed(4) : 'N/A'],
              ['F-Statistic',          result.fStatistic !== null ? result.fStatistic.toFixed(2) : 'N/A'],
              ['Pass Criteria',        'R² ≥ 0.80, β ∈ [−1.25, −0.80]'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.375rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Result</span>
              <ResultBadge result={result.prospectiveResult} />
            </div>
          </div>
        </div>

        {/* Ineffectiveness detail */}
        <div style={cardStyle}>
          <div style={labelStyle}>Ineffectiveness Breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[
              ['|ΔFV Instrument| (USD)',  fmtUsd(result.deltaFvInstrument)],
              ['|ΔFV Hedged Item| (USD)', fmtUsd(result.deltaFvHedgedItem)],
              ['Effective Portion (OCI)', fmtUsd(result.effectivePortionUsd)],
              ['Ineffective (P&L)',       fmtUsd(result.ineffectivePortionUsd)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{v}</span>
              </div>
            ))}
            {result.ineffectivePortionUsd > 0 && (
              <div style={{ marginTop: '0.25rem', padding: '0.375rem 0.5rem', background: '#2b0d0d', borderRadius: 4, fontSize: '0.75rem', color: '#ef4444' }}>
                Ineffective portion of {fmtUsd(result.ineffectivePortionUsd)} must be recognized in P&L immediately per {
                  result.designationMemo.accountingStandard === 'ASC 815'
                    ? 'ASC 815-20-35-1'
                    : 'IFRS 9 6.5.11'
                }.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  positions: HedgePosition[]
}

export function HedgeEffectivenessPanel({ positions }: Props) {
  const { ratesMap, loading: ratesLoading } = useLiveFxRates()
  const { db, user } = useAuth()

  const [standard, setStandard]           = useState<AccountingStandard>('ASC 815')
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set())
  const [histRates, setHistRates]         = useState<Record<string, HistoricalRateRow[]>>({})
  const [histLoading, setHistLoading]     = useState(false)

  // Fetch historical rates for each unique currency pair
  const pairs = useMemo(
    () => [...new Set(positions.map(p => p.currency_pair))],
    [positions],
  )

  const fetchHistoricalRates = useCallback(async () => {
    if (!db || !user || pairs.length === 0) return
    setHistLoading(true)
    try {
      const results: Record<string, HistoricalRateRow[]> = {}
      await Promise.all(pairs.map(async pair => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase typed client
        const { data, error } = await db
          .from('fx_rates')
          .select('currency_pair,rate,rate_date')
          .eq('currency_pair', pair)
          .order('rate_date', { ascending: true })
        if (!error && data) {
          results[pair] = (data as { currency_pair: string; rate: number; rate_date: string }[]).map(r => ({
            date: r.rate_date,
            rate: r.rate,
          }))
        }
      }))
      setHistRates(results)
    } finally {
      setHistLoading(false)
    }
  }, [db, user, pairs])

  useEffect(() => {
    fetchHistoricalRates()
  }, [fetchHistoricalRates])

  // Compute effectiveness results
  const results = useMemo((): HedgeEffectivenessResult[] => {
    if (positions.length === 0 || Object.keys(ratesMap).length === 0) return []
    return positions
      .filter(p => p.status === 'active')
      .map(p => computeEffectiveness(
        p,
        ratesMap,
        histRates[p.currency_pair] ?? [],
      ))
  }, [positions, ratesMap, histRates])

  const summary = useMemo(() => getEffectivenessSummary(results), [results])

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isLoading = ratesLoading || histLoading

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (positions.filter(p => p.status === 'active').length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <CheckCircle size={36} color="var(--text-muted)" style={{ marginBottom: '0.75rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          No active hedge positions to test. Add positions in the Hedges page.
        </p>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Disclaimer banner */}
      <div style={{
        background: '#2b1d06', border: '1px solid #92400e', borderRadius: 6,
        padding: '0.75rem 1rem',
        display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
      }}>
        <AlertTriangle size={15} color="#f59e0b" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#fcd34d', lineHeight: 1.5 }}>
          <strong>Informational only.</strong> This analysis is generated automatically and has not been
          audited. All hedge effectiveness tests must be reviewed by a qualified accountant before
          inclusion in financial statements under ASC 815 or IFRS 9.
        </p>
      </div>

      {/* Standard selector + Export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>Standard:</span>
          {(['ASC 815', 'IFRS 9'] as AccountingStandard[]).map(s => (
            <button
              key={s}
              onClick={() => setStandard(s)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: 20,
                fontSize: '0.8rem',
                fontWeight: standard === s ? 700 : 400,
                cursor: 'pointer',
                border: `1.5px solid ${standard === s ? 'var(--teal)' : 'var(--border)'}`,
                background: standard === s ? 'var(--teal)' : 'var(--bg-surface)',
                color: standard === s ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {s === 'ASC 815' ? 'ASC 815 (US GAAP)' : 'IFRS 9 (IFRS)'}
            </button>
          ))}
        </div>
        <button
          onClick={() => void exportAuditReport(results, standard)}
          disabled={results.length === 0}
          className="btn btn-primary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
        >
          <Download size={13} /> Export Audit Report
        </button>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          <Clock size={13} />
          {ratesLoading ? 'Fetching live rates…' : 'Loading historical rate data…'}
        </div>
      )}

      {/* KPI summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        {[
          {
            label: 'Hedges Tested',
            value: summary.totalCount.toString(),
            color: 'var(--text-primary)',
            icon: <Info size={14} color="var(--text-muted)" />,
          },
          {
            label: `Effective (${summary.totalCount > 0 ? ((summary.passCount / summary.totalCount) * 100).toFixed(0) : 0}%)`,
            value: summary.passCount.toString(),
            color: '#10b981',
            icon: <CheckCircle size={14} color="#10b981" />,
          },
          {
            label: 'Needs Review',
            value: summary.needsReviewCount.toString(),
            color: '#f59e0b',
            icon: <AlertTriangle size={14} color="#f59e0b" />,
          },
          {
            label: 'Total Ineffectiveness to P&L',
            value: fmtUsd(summary.totalIneffectivePortionUsd),
            color: summary.totalIneffectivePortionUsd > 0 ? '#ef4444' : '#10b981',
            icon: <XCircle size={14} color={summary.totalIneffectivePortionUsd > 0 ? '#ef4444' : '#10b981'} />,
          },
        ].map(card => (
          <div key={card.label} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>{card.label}</span>
              {card.icon}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: card.color }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Effectiveness table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Hedge Effectiveness Test Results</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Test date: {results[0]?.testDate ?? new Date().toISOString().split('T')[0]}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <th style={thStyle}></th>
                <th style={thStyle}>Ref #</th>
                <th style={thStyle}>Pair</th>
                <th style={thStyle}>Dir</th>
                <th style={thStyle}>Notional</th>
                <th style={thStyle}>Maturity</th>
                <th style={thStyle}>Contracted</th>
                <th style={thStyle}>Current</th>
                <th style={thStyle}>ΔFV Instr (USD)</th>
                <th style={thStyle}>ΔFV Item (USD)</th>
                <th style={thStyle}>Offset %</th>
                <th style={thStyle}>Retro</th>
                <th style={thStyle}>R²</th>
                <th style={thStyle}>Prosp.</th>
                <th style={thStyle}>Ineff. P&L</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const isExpanded = expandedIds.has(r.hedgeId)
                return (
                  <>
                    <tr
                      key={r.hedgeId}
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onClick={() => toggleExpand(r.hedgeId)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ ...tdStyle, width: 28, paddingLeft: '0.75rem' }}>
                        {isExpanded
                          ? <ChevronDown size={13} color="var(--text-muted)" />
                          : <ChevronRight size={13} color="var(--text-muted)" />}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--teal)', fontSize: '0.75rem' }}>
                        {r.referenceNumber.length > 12 ? r.referenceNumber.slice(0, 10) + '…' : r.referenceNumber}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.currencyPair}</td>
                      <td style={tdStyle}>
                        <span style={{
                          color: r.direction === 'sell' ? '#f59e0b' : '#10b981',
                          fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase',
                        }}>
                          {r.direction}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                        {r.notionalBase.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{r.maturityDate}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{r.contractedRate.toFixed(4)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{r.currentSpotRate.toFixed(4)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: r.deltaFvInstrument >= 0 ? '#10b981' : '#ef4444' }}>
                        {r.deltaFvInstrument >= 0 ? '+' : ''}{fmtUsd(r.deltaFvInstrument)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: r.deltaFvHedgedItem >= 0 ? '#10b981' : '#ef4444' }}>
                        {r.deltaFvHedgedItem >= 0 ? '+' : ''}{fmtUsd(r.deltaFvHedgedItem)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                        {fmt(r.dollarOffsetRatioPct)}%
                      </td>
                      <td style={tdStyle}><ResultBadge result={r.retrospectiveResult} /></td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {r.rSquared !== null ? r.rSquared.toFixed(3) : '—'}
                      </td>
                      <td style={tdStyle}><ResultBadge result={r.prospectiveResult} /></td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: r.ineffectivePortionUsd > 0 ? '#ef4444' : 'var(--text-muted)' }}>
                        {r.ineffectivePortionUsd > 0 ? fmtUsd(r.ineffectivePortionUsd) : '—'}
                      </td>
                      <td style={tdStyle}><StatusBadge status={r.overallStatus} /></td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${r.hedgeId}-detail`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={16} style={{ padding: 0 }}>
                          <ExpandedDetail result={r} standard={standard} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {results.length === 0 && !isLoading && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Waiting for live rates to compute effectiveness tests…
          </div>
        )}
      </div>

      {/* Footer note */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: '0.125rem' }} />
        <span>
          Retrospective test uses the dollar-offset method ({standard === 'ASC 815' ? 'ASC 815-20-35-2' : 'IFRS 9 B6.4.1'}).
          Prospective test uses OLS linear regression on historical monthly rate changes (minimum 8 observations).
          Current rates sourced from ECB via Frankfurter API.
        </span>
      </div>

    </div>
  )
}

// ── Table style constants ─────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.625rem',
  textAlign: 'left',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.625rem',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  color: 'var(--text-primary)',
}
