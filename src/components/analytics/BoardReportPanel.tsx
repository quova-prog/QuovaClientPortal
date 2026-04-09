import { useState, useMemo } from 'react'
import {
  FileText, Presentation, Settings, Eye, Download,
  AlertTriangle, Clock, BarChart3, Calendar, Shield,
  TrendingUp, RefreshCw, CheckSquare, Square,
} from 'lucide-react'
import type { CombinedCoverage } from '@/hooks/useCombinedCoverage'
import type { CashFlowEntry } from '@/hooks/useCashFlows'
import type { HedgePosition } from '@/types'
import { toUsd } from '@/lib/fx'
import type {
  BoardReportData,
  CoveragePairRow,
  PositionRow,
  MaturityRow,
  FlowRow,
} from '@/lib/boardReportPdf'

// ── Props ─────────────────────────────────────────────────────────────────────

interface BoardReportPanelProps {
  combinedCoverage: CombinedCoverage[]
  positions: HedgePosition[]
  flows: CashFlowEntry[]
  fxRates: Record<string, number>
  policyMinPct: number
  policyMaxPct: number
  baseCurrency: string
  totalExposureUsd: number
  totalHedgedUsd: number
  overallCoveragePct: number
  complianceStatus: 'compliant' | 'under_hedged' | 'over_hedged'
  preparedBy: string
  orgName?: string
}

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'executive_summary',   label: 'Executive Summary',       description: 'Key portfolio KPIs and highlights',                Icon: BarChart3   },
  { id: 'exposure_policy',     label: 'Exposure vs Policy',       description: 'FX exposure by currency pair vs policy thresholds', Icon: Shield      },
  { id: 'hedge_portfolio',     label: 'Hedge Portfolio & MTM',    description: 'Active positions with mark-to-market valuations',   Icon: TrendingUp  },
  { id: 'upcoming_maturities', label: 'Upcoming Maturities',      description: 'Positions maturing within 90 days',                Icon: Calendar    },
  { id: 'policy_compliance',   label: 'Policy Compliance',        description: 'Compliance status and risk statement',              Icon: Shield      },
  { id: 'cash_flows',          label: 'Cash Flow Schedule',       description: 'Upcoming cash flows within 30 days',               Icon: Clock       },
]

// ── Current quarter helper ────────────────────────────────────────────────────

function getCurrentQuarter(): string {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3) + 1
  return `Q${q} ${now.getFullYear()}`
}

// ── Panel component ───────────────────────────────────────────────────────────

export function BoardReportPanel({
  combinedCoverage,
  positions,
  flows,
  fxRates,
  policyMinPct,
  policyMaxPct,
  baseCurrency,
  totalExposureUsd,
  totalHedgedUsd,
  overallCoveragePct,
  complianceStatus,
  preparedBy,
  orgName,
}: BoardReportPanelProps) {
  const [companyName,    setCompanyName   ] = useState<string>(orgName ?? 'My Company')
  const [reportPeriod,   setReportPeriod  ] = useState<string>(getCurrentQuarter())
  const [generatingPdf,  setGeneratingPdf ] = useState(false)
  const [generatingPptx, setGeneratingPptx] = useState(false)
  const [lastGenerated,  setLastGenerated ] = useState<Date | null>(null)
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    new Set(SECTIONS.map(s => s.id))
  )

  // ── Build report data ────────────────────────────────────────────────────────

  const reportData = useMemo<Omit<BoardReportData, 'companyName' | 'reportPeriod' | 'generatedAt' | 'preparedBy'>>(() => {
    // Over-hedged positions create directional risk too — use absolute unhedged for VaR
    const var95Usd = Math.abs(totalExposureUsd - totalHedgedUsd) * 0.12 * 1.645

    // Coverage by pair
    const coverageByPair: CoveragePairRow[] = combinedCoverage.map(c => {
      const exposureUsd = toUsd(Math.abs(c.net_exposure), c.base_currency, fxRates)
      const hedgedUsd   = toUsd(c.total_hedged, c.base_currency, fxRates)
      const unhedgedUsd = toUsd(c.unhedged_amount, c.base_currency, fxRates)
      let status: CoveragePairRow['status']
      if (c.coverage_pct < 1) status = 'unhedged'
      else if (c.coverage_pct < policyMinPct) status = 'under'
      else if (c.coverage_pct > policyMaxPct) status = 'over'
      else status = 'compliant'
      return {
        pair: c.currency_pair,
        exposureUsd,
        hedgedUsd,
        unhedgedUsd,
        coveragePct: c.coverage_pct,
        status,
      }
    })

    // Active positions with MTM
    const activePositions: PositionRow[] = positions.map(p => {
      const pair = p.currency_pair
      const reversedPair = pair.includes('/') ? pair.split('/').reverse().join('/') : ''
      const currentRate =
        fxRates[pair] ??
        (fxRates[reversedPair] ? 1 / fxRates[reversedPair] : undefined) ??
        p.contracted_rate

      // rawMtm is in the quote currency of the pair (e.g. USD for EUR/USD, JPY for USD/JPY, CAD for EUR/CAD)
      const rawMtm = p.direction === 'buy'
        ? (currentRate - p.contracted_rate) * p.notional_base
        : (p.contracted_rate - currentRate) * p.notional_base

      // Convert from quote currency to USD
      const quoteCcy = pair.split('/')[1] ?? 'USD'
      const mtmUsd = toUsd(Math.abs(rawMtm), quoteCcy, fxRates) * (rawMtm >= 0 ? 1 : -1)

      return {
        pair,
        instrument: p.instrument_type,
        direction: p.direction,
        notionalBase: p.notional_base,
        baseCcy: p.base_currency,
        contractedRate: p.contracted_rate,
        currentRate,
        mtmUsd,
        valueDate: p.value_date,
        counterparty: p.counterparty_bank ?? '—',
      }
    })

    // Upcoming maturities (within 90 days, status=active)
    const now = new Date()
    const in90 = new Date(now.getTime() + 90 * 86400000)
    const upcomingMaturities: MaturityRow[] = positions
      .filter(p => p.status === 'active' && new Date(p.value_date) <= in90)
      .map(p => {
        const daysToMaturity = Math.max(
          0,
          Math.ceil((new Date(p.value_date).getTime() - now.getTime()) / 86400000),
        )
        return {
          pair: p.currency_pair,
          instrument: p.instrument_type,
          notionalBase: p.notional_base,
          baseCcy: p.base_currency,
          valueDate: p.value_date,
          daysToMaturity,
          contractedRate: p.contracted_rate,
          counterparty: p.counterparty_bank ?? '—',
        }
      })
      .sort((a, b) => new Date(a.valueDate).getTime() - new Date(b.valueDate).getTime())

    // Upcoming flows (within 30 days)
    const in30 = new Date(now.getTime() + 30 * 86400000)
    const upcomingFlows: FlowRow[] = flows
      .filter(f => {
        const d = new Date(f.flow_date)
        return d >= now && d <= in30
      })
      .map(f => ({
        date: f.flow_date,
        currency: f.currency,
        amount: f.amount,
        flowType: f.flow_type,
        counterparty: f.counterparty ?? '—',
      }))

    return {
      policyMinPct,
      policyMaxPct,
      baseCurrency,
      totalExposureUsd,
      totalHedgedUsd,
      overallCoveragePct,
      complianceStatus,
      var95Usd,
      coverageByPair,
      activePositions,
      upcomingMaturities,
      upcomingFlows,
    }
  }, [combinedCoverage, positions, flows, fxRates, policyMinPct, policyMaxPct, baseCurrency, totalExposureUsd, totalHedgedUsd, overallCoveragePct, complianceStatus])

  // ── Generation handlers ──────────────────────────────────────────────────────

  async function handleGeneratePdf() {
    setGeneratingPdf(true)
    await new Promise(r => setTimeout(r, 50))
    try {
      const { generateBoardReportPdf } = await import('@/lib/boardReportPdf')
      generateBoardReportPdf({
        ...reportData,
        companyName,
        reportPeriod,
        generatedAt: new Date(),
        preparedBy,
      })
      setLastGenerated(new Date())
    } finally {
      setGeneratingPdf(false)
    }
  }

  async function handleGeneratePptx() {
    setGeneratingPptx(true)
    await new Promise(r => setTimeout(r, 50))
    try {
      const { generateBoardReportPptx } = await import('@/lib/boardReportPptx')
      await generateBoardReportPptx({
        ...reportData,
        companyName,
        reportPeriod,
        generatedAt: new Date(),
        preparedBy,
      })
      setLastGenerated(new Date())
    } finally {
      setGeneratingPptx(false)
    }
  }

  // ── Section toggles ──────────────────────────────────────────────────────────

  function toggleSection(id: string) {
    setSelectedSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Derived counts ───────────────────────────────────────────────────────────

  const maturingCount = reportData.upcomingMaturities.length
  const urgentCount   = reportData.upcomingMaturities.filter(m => m.daysToMaturity < 30).length
  const flowCount     = reportData.upcomingFlows.length

  const sectionBadges: Record<string, string> = {
    executive_summary:   '4 metrics · 6 highlights',
    exposure_policy:     `${reportData.coverageByPair.length} currency pair${reportData.coverageByPair.length !== 1 ? 's' : ''}`,
    hedge_portfolio:     `${reportData.activePositions.length} position${reportData.activePositions.length !== 1 ? 's' : ''}`,
    upcoming_maturities: maturingCount > 0 ? `${maturingCount} maturing${urgentCount > 0 ? `, ${urgentCount} urgent` : ''}` : 'None in window',
    policy_compliance:   complianceStatus === 'compliant' ? 'Compliant' : 'Policy breach',
    cash_flows:          `${flowCount} flow${flowCount !== 1 ? 's' : ''}`,
  }

  // ── Last-generated relative time ─────────────────────────────────────────────

  function relativeTime(d: Date): string {
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins === 1) return '1 min ago'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.floor(mins / 60)
    return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 0' }}>

      {/* ── Compliance Warning ─────────────────────────────────────────── */}
      {complianceStatus !== 'compliant' && (
        <div style={{
          background: 'rgba(217,119,6,0.08)',
          border: '1px solid rgba(217,119,6,0.35)',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <AlertTriangle size={18} color="var(--amber, #D97706)" />
          <div>
            <span style={{ fontWeight: 600, color: 'var(--amber, #D97706)', fontSize: 13 }}>
              Policy Breach Detected
            </span>
            <span style={{ color: 'var(--text-secondary, #64748B)', fontSize: 13, marginLeft: 6 }}>
              — This report will flag a compliance breach. Review the exposure data before distributing to the board.
            </span>
          </div>
        </div>
      )}

      {/* ── Section 1: Report Configuration ──────────────────────────── */}
      <div style={{
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 10,
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Settings size={16} color="var(--teal, #14b8a6)" />
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary, #f1f5f9)' }}>
            Report Configuration
          </span>
        </div>

        {/* Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 6 }}>
              Company / Organization Name
            </label>
            <input
              type="text"
              className="input"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 6 }}>
              Report Period (e.g. "Q2 2026")
            </label>
            <input
              type="text"
              className="input"
              value={reportPeriod}
              onChange={e => setReportPeriod(e.target.value)}
            />
          </div>
        </div>

        {/* Section toggles */}
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 10 }}>
            Sections to include
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {SECTIONS.map(sec => {
              const checked = selectedSections.has(sec.id)
              return (
                <button
                  key={sec.id}
                  onClick={() => toggleSection(sec.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: checked ? 'rgba(20,184,166,0.08)' : 'transparent',
                    border: `1px solid ${checked ? 'rgba(20,184,166,0.35)' : 'var(--border, rgba(255,255,255,0.08))'}`,
                    borderRadius: 6,
                    padding: '7px 10px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {checked
                    ? <CheckSquare size={14} color="var(--teal, #14b8a6)" />
                    : <Square size={14} color="var(--text-muted, #94a3b8)" />
                  }
                  <span style={{
                    fontSize: 12,
                    color: checked ? 'var(--teal, #14b8a6)' : 'var(--text-muted, #94a3b8)',
                  }}>
                    {sec.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Section 2: Report Preview ─────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 10,
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Eye size={16} color="var(--teal, #14b8a6)" />
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary, #f1f5f9)' }}>
            What's Included
          </span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--text-muted, #94a3b8)',
            background: 'var(--bg-base, #0f172a)',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: 10,
            padding: '2px 8px',
          }}>
            {selectedSections.size} / {SECTIONS.length} sections
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {SECTIONS.map((sec, idx) => {
            const active = selectedSections.has(sec.id)
            const badge = sectionBadges[sec.id]
            const { Icon } = sec
            const isUrgent = sec.id === 'upcoming_maturities' && urgentCount > 0

            return (
              <div
                key={sec.id}
                style={{
                  background: active ? 'var(--bg-base, #0f172a)' : 'rgba(15,23,42,0.3)',
                  border: `1px solid ${active ? 'var(--border, rgba(255,255,255,0.08))' : 'rgba(255,255,255,0.04)'}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  opacity: active ? 1 : 0.45,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Icon size={14} color={active ? 'var(--teal, #14b8a6)' : 'var(--text-muted, #94a3b8)'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f1f5f9)', flex: 1 }}>
                    {String(idx + 1).padStart(2, '0')}. {sec.label}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', margin: '4px 0' }}>
                  {sec.description}
                </p>
                {badge && (
                  <span style={{
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 10,
                    background: isUrgent ? 'rgba(220,38,38,0.15)' : 'rgba(20,184,166,0.12)',
                    color: isUrgent ? '#ef4444' : 'var(--teal, #14b8a6)',
                    border: `1px solid ${isUrgent ? 'rgba(220,38,38,0.3)' : 'rgba(20,184,166,0.25)'}`,
                    display: 'inline-block',
                    marginTop: 2,
                  }}>
                    {badge}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 3: Generate Report ────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 10,
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Download size={16} color="var(--teal, #14b8a6)" />
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary, #f1f5f9)' }}>
            Generate Report
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          {/* Left: description */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #94a3b8)', margin: '0 0 8px' }}>
              One-click board-ready reports. PDF for distribution and archiving. PowerPoint for board presentations.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', margin: 0 }}>
              Report will include 6 pages / 6 slides · Prepared by: {preparedBy}
            </p>
            {lastGenerated && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
                <Clock size={12} color="var(--text-muted, #64748b)" />
                <span style={{ fontSize: 11, color: 'var(--text-muted, #64748b)' }}>
                  Last generated: {relativeTime(lastGenerated)}
                </span>
              </div>
            )}
          </div>

          {/* Right: action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
            <button
              onClick={handleGeneratePdf}
              disabled={generatingPdf || generatingPptx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 18px',
                background: 'var(--teal, #14b8a6)',
                border: 'none',
                borderRadius: 7,
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: generatingPdf || generatingPptx ? 'not-allowed' : 'pointer',
                opacity: generatingPdf || generatingPptx ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {generatingPdf
                ? <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                : <FileText size={14} />
              }
              {generatingPdf ? 'Generating…' : 'Export PDF'}
            </button>

            <button
              onClick={handleGeneratePptx}
              disabled={generatingPdf || generatingPptx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 18px',
                background: 'transparent',
                border: '1px solid var(--border, rgba(255,255,255,0.15))',
                borderRadius: 7,
                color: 'var(--text-primary, #f1f5f9)',
                fontWeight: 600,
                fontSize: 13,
                cursor: generatingPdf || generatingPptx ? 'not-allowed' : 'pointer',
                opacity: generatingPdf || generatingPptx ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {generatingPptx
                ? <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                : <Presentation size={14} />
              }
              {generatingPptx ? 'Generating…' : 'Export PowerPoint'}
            </button>
          </div>
        </div>
      </div>

      {/* Spin keyframe */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ── Helper (used in render) ───────────────────────────────────────────────────

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`
}
