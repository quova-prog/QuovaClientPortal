import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import {
  Sparkles, Brain, RefreshCw, AlertTriangle, CheckCircle2,
  Shield, TrendingDown, Zap, Clock, ChevronRight,
  ArrowRight, Info, Activity,
} from 'lucide-react'
import { useAdvisorEngine } from '@/hooks/useAdvisorEngine'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useHedgePositions } from '@/hooks/useData'
import { formatCurrency } from '@/lib/utils'
import type { Strategy, RiskMetrics, CurrencyRisk } from '@/lib/advisorEngine'
import type { AiAnalysis } from '@/lib/claudeClient'
import { ScenarioPanel } from '@/components/advisor/ScenarioPanel'

// ── Formatters ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString()}`
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function Skeleton({ w = '100%', h = 16 }: { w?: string; h?: number }) {
  return (
    <div
      className="rounded animate-pulse"
      style={{ width: w, height: h, background: 'rgba(255,255,255,0.06)' }}
    />
  )
}

// ── CFO Section ────────────────────────────────────────────────────────────

function CfoSection({
  ai, metrics, topStrategy, aiLoading, aiConfigured, onExecute,
}: {
  ai: AiAnalysis | null
  metrics: RiskMetrics
  topStrategy: Strategy
  aiLoading: boolean
  aiConfigured: boolean
  onExecute: () => void
}) {
  const priorityConfig = {
    immediate:  { label: 'Act Now',       color: 'var(--red)',   bg: '#fef2f2',   icon: AlertTriangle },
    this_week:  { label: 'Act This Week', color: 'var(--amber)', bg: '#fffbeb',   icon: Clock },
    monitor:    { label: 'Monitor',       color: 'var(--teal)',  bg: '#f0fdfa',   icon: CheckCircle2 },
  }
  const priority = ai?.actionPriority ?? 'monitor'
  const pc = priorityConfig[priority]
  const PIcon = pc.icon

  return (
    <div
      className="card"
      style={{
        padding: 0,
        border: '1.5px solid',
        borderColor: metrics.policyBreached ? 'rgba(239,68,68,0.3)' : 'rgba(20,184,166,0.25)',
        background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(20,184,166,0.02) 100%)',
      }}
    >
      {/* CFO label */}
      <div
        style={{
          padding: '0.5rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'rgba(20,184,166,0.04)',
        }}
      >
        <Sparkles size={12} color="var(--teal)" />
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--teal)' }}>
          Executive Summary
        </span>
        {!aiConfigured && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Local deterministic summary
          </span>
        )}
      </div>

      <div style={{ padding: '1.25rem' }}>
        {/* AI Headline */}
        <div style={{ marginBottom: '1.25rem', minHeight: 40 }}>
          {aiLoading
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton h={22} w="90%" />
                <Skeleton h={22} w="70%" />
              </div>
            : <p style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.45, fontStyle: 'italic' }}>
                {ai?.cfoCoverHeadline?.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '')}
              </p>
          }
        </div>

        {/* KPI tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '1.25rem' }}>
          {/* At Risk */}
          <div className="card" style={{ padding: '0.875rem', background: 'var(--bg-surface)' }}>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>P&L at Risk (95%)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.25rem', color: 'var(--red)', letterSpacing: '-0.02em' }}>
              {fmt(metrics.var95Usd)}
            </div>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>annual / 1-year horizon</div>
          </div>

          {/* Coverage */}
          <div className="card" style={{ padding: '0.875rem', background: 'var(--bg-surface)' }}>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>Current Coverage</div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.02em',
              color: metrics.policyBreached ? 'var(--red)' : 'var(--teal)',
            }}>
              {metrics.currentHedgeRatioPct.toFixed(1)}%
            </div>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              policy: {metrics.policyMinPct}%–{metrics.policyMaxPct}%
            </div>
          </div>

          {/* Policy status — clickable, scrolls to execution plan */}
          <div
            className="card"
            onClick={onExecute}
            style={{
              padding: '0.875rem', background: pc.bg, cursor: 'pointer',
              border: `1px solid ${pc.color}33`,
              transition: 'box-shadow 0.15s, transform 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${pc.color}22`; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.transform = '' }}
            title="Click to view execution plan"
          >
            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>Action Required</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.125rem' }}>
              <PIcon size={14} color={pc.color} />
              <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: pc.color }}>{pc.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                {metrics.nearestSettlementDays}d to nearest settlement
              </div>
              <ChevronRight size={12} color={pc.color} style={{ opacity: 0.6 }} />
            </div>
          </div>
        </div>

        {/* Risk explanation */}
        {(aiLoading || ai?.riskExplanation) && (
          <div style={{ marginBottom: '1.25rem', padding: '0.875rem', borderRadius: 'var(--r-sm)', background: 'var(--bg-surface)', borderLeft: '3px solid var(--border)' }}>
            {aiLoading
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skeleton h={14} /><Skeleton h={14} w="80%" />
                </div>
              : <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  {ai?.riskExplanation?.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '')}
                </p>
            }
          </div>
        )}

        {/* Top recommendation */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--r-sm)',
            background: 'rgba(20,184,166,0.07)',
            border: '1px solid rgba(20,184,166,0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.625rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span className="badge badge-teal" style={{ fontSize: '0.625rem' }}>#1 RECOMMENDED</span>
                <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                  Strategy {topStrategy.id}: {topStrategy.name}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {topStrategy.instruments.map(inst => (
                  <span key={inst.type} className="badge badge-gray" style={{ fontSize: '0.625rem' }}>
                    {inst.pct}% {inst.type}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={onExecute}
              className="btn btn-primary btn-sm"
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              Execute <ArrowRight size={12} />
            </button>
          </div>

          {aiLoading
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton h={13} /><Skeleton h={13} w="75%" /></div>
            : <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 0.75rem 0' }}>
                {ai?.recommendationRationale}
              </p>
          }

          {/* Quick metrics row */}
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Coverage target', value: `${topStrategy.targetHedgeRatioPct}%` },
              { label: 'Est. cost',        value: `${topStrategy.estimatedCostBps} bps/yr` },
              { label: 'Vol. reduction',   value: `${topStrategy.volatilityReductionPct}%` },
              { label: 'Tenor',            value: `${topStrategy.recommendedTenorMonths}m` },
              { label: 'Policy score',     value: `${topStrategy.policyComplianceScore}/100` },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Strategy card ──────────────────────────────────────────────────────────

function StrategyCard({ strategy, rank, tradesCount, isSelected, onSelect }: {
  strategy: Strategy; rank: number; tradesCount: number; isSelected: boolean; onSelect: () => void
}) {
  const complexityBadge = {
    low:    { label: 'Simple',   cls: 'badge-green' },
    medium: { label: 'Moderate', cls: 'badge-amber' },
    high:   { label: 'Complex',  cls: 'badge-red' },
  }[strategy.executionComplexity]

  return (
    <div
      className="card"
      onClick={onSelect}
      style={{
        padding: 0,
        opacity: isSelected ? 1 : 0.82,
        cursor: 'pointer',
        border: isSelected ? '2px solid var(--teal)' : '1px solid var(--border)',
        transition: 'border-color 0.15s, opacity 0.15s, box-shadow 0.15s',
        boxShadow: isSelected ? '0 0 0 3px rgba(20,184,166,0.12)' : undefined,
      }}
    >
      {/* Header */}
      <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isSelected ? 'var(--teal)' : 'var(--bg-surface)',
          color: isSelected ? '#fff' : 'var(--text-muted)',
          fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
          border: isSelected ? 'none' : '1px solid var(--border)',
        }}>
          {rank}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.125rem' }}>
            Strategy {strategy.id}: {strategy.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{strategy.tagline}</div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.125rem', color: isSelected ? 'var(--teal)' : 'var(--text-secondary)' }}>
          {Math.round(strategy.overallScore)}
          <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-muted)' }}>/100</span>
        </div>
      </div>

      {/* Instrument pills */}
      <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
        {strategy.instruments.map(i => (
          <span key={i.type} className="badge badge-teal" style={{ fontSize: '0.625rem' }}>{i.pct}% {i.type}</span>
        ))}
        <span className="badge badge-gray" style={{ fontSize: '0.625rem' }}>
          {tradesCount} trade{tradesCount !== 1 ? 's' : ''}
        </span>
        <span className={`badge ${complexityBadge.cls}`} style={{ marginLeft: 'auto', fontSize: '0.625rem' }}>
          {complexityBadge.label} execution
        </span>
      </div>

      {/* Metrics grid */}
      <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
          {[
            { label: 'Target coverage',    value: `${strategy.targetHedgeRatioPct}%` },
            { label: 'Coverage gain',      value: `+${strategy.coverageGainPct.toFixed(1)}%` },
            { label: 'Annual cost',        value: `${strategy.estimatedCostBps} bps` },
            { label: 'Est. cost (USD)',    value: fmt(strategy.estimatedCostUsd) },
            { label: 'Vol. reduction',     value: `${strategy.volatilityReductionPct}%` },
            { label: 'VaR after',          value: fmt(strategy.var95AfterUsd) },
            { label: 'Policy score',       value: `${strategy.policyComplianceScore}/100` },
            { label: 'Recommended tenor',  value: `${strategy.recommendedTenorMonths} months` },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.125rem' }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Backtest chart ─────────────────────────────────────────────────────────

function BacktestChart({
  backtest,
}: {
  backtest: NonNullable<ReturnType<typeof useAdvisorEngine>['backtest']>
}) {
  const total   = backtest.totalHedgeBenefitUsd
  const winRate = backtest.winRatePct
  const avg     = backtest.avgMonthlyBenefitUsd

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const val = payload[0]?.value as number
    return (
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
        <div style={{ color: val >= 0 ? 'var(--teal)' : 'var(--red)' }}>
          Cumulative: {val >= 0 ? '+' : ''}{fmt(val)}
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.125rem' }}>
            <Activity size={14} color="var(--teal)" />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>24-Month Strategy Simulation</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Strategy A (100% Forward) · Portfolio · {backtest.pairsCovered} of {backtest.totalPairs} pairs with ECB history
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total benefit</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem', color: total >= 0 ? 'var(--teal)' : 'var(--red)' }}>
              {total >= 0 ? '+' : ''}{fmt(total)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Win rate</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem' }}>
              {winRate.toFixed(0)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Avg/month</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem', color: avg >= 0 ? 'var(--teal-dark)' : 'var(--red)' }}>
              {avg >= 0 ? '+' : ''}{fmt(avg)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0.5rem 0.25rem 0.75rem', height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={backtest.monthlyData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--teal)" stopOpacity={0.18} />
                <stop offset="95%" stopColor="var(--teal)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="negGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--red)" stopOpacity={0.18} />
                <stop offset="95%" stopColor="var(--red)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              axisLine={false} tickLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickFormatter={v => fmt(v)}
              axisLine={false} tickLine={false}
              width={56}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Area
              type="monotone"
              dataKey="hedgedCumulativeUsd"
              name="Hedge benefit"
              stroke="var(--teal)"
              strokeWidth={2}
              fill="url(#posGrad)"
              dot={false}
              activeDot={{ r: 4, fill: 'var(--teal)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ padding: '0.5rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Info size={11} color="var(--text-muted)" />
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
          Portfolio simulation using ECB reference rates (Frankfurter API). Each pair weighted by USD-equivalent exposure; pairs without ECB history excluded.
          Past performance does not guarantee future results.
        </span>
      </div>
    </div>
  )
}

// ── Execution plan ─────────────────────────────────────────────────────────

function ExecutionPlan({
  metrics, strategy, onExecute,
}: {
  metrics: RiskMetrics
  strategy: Strategy
  onExecute: (cr: CurrencyRisk, gapUsd: number) => void
}) {
  const tenorMonths = strategy.recommendedTenorMonths
  const targetPct   = strategy.targetHedgeRatioPct

  // Compute per-pair gap to THIS strategy's target (not just policy min)
  const gapsWithTarget = metrics.currencyRisks
    .map(cr => {
      const gapToTarget = cr.hedgedUsd - cr.exposureUsd * (targetPct / 100)  // negative = needs hedging
      return { cr, gapToTarget }
    })
    .filter(({ gapToTarget }) => gapToTarget < 0)

  const label = gapsWithTarget.length === 0
    ? `All currencies meet the ${targetPct}% target`
    : `${gapsWithTarget.length} trade${gapsWithTarget.length !== 1 ? 's' : ''} to reach ${targetPct}% target`

  return (
    <div className="card" id="execution-plan" style={{ padding: 0 }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Zap size={14} color="var(--teal)" />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Execution Plan</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>— {label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '0.125rem 0.625rem' }}>
            Strategy {strategy.id}: {strategy.name}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {tenorMonths}m · {strategy.instruments.map(i => `${i.pct}% ${i.type}`).join(' + ')}
          </span>
        </div>
      </div>

      {gapsWithTarget.length === 0 ? (
        <div style={{ padding: '1.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={16} color="var(--teal)" />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            All currencies are at or above the {targetPct}% strategy target — no trades required.
          </span>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Pair', 'Exposure', 'Current cover', `Gap to ${targetPct}% target`, 'Recommended notional', ''].map(h => (
                <th key={h} style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gapsWithTarget.map(({ cr, gapToTarget }, i) => {
              const gapUsd = Math.abs(gapToTarget)
              const coverColor = cr.coveragePct < metrics.policyMinPct ? 'var(--red)' : 'var(--amber)'
              return (
              <tr
                key={cr.pair}
                style={{ borderBottom: i < gapsWithTarget.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
              >
                <td style={{ padding: '0.625rem 1rem', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8125rem' }}>{cr.pair}</td>
                <td style={{ padding: '0.625rem 1rem', fontFamily: 'var(--font-mono)' }}>{fmt(cr.exposureUsd)}</td>
                <td style={{ padding: '0.625rem 1rem' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: coverColor, fontWeight: 600 }}>
                    {cr.coveragePct.toFixed(0)}%
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}> (target {targetPct}%)</span>
                </td>
                <td style={{ padding: '0.625rem 1rem', fontFamily: 'var(--font-mono)', color: 'var(--red)', fontWeight: 600 }}>
                  {fmt(gapUsd)}
                </td>
                <td style={{ padding: '0.625rem 1rem' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--teal)', fontWeight: 600 }}>
                    {fmt(gapUsd)} · {tenorMonths}m
                  </div>
                  {strategy.instruments.length > 1 && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                      {strategy.instruments.map(inst => `${fmt(gapUsd * inst.pct / 100)} ${inst.type}`).join(' + ')}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.625rem 1rem', textAlign: 'right' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onExecute(cr, gapUsd)}
                    style={{ fontSize: '0.6875rem', padding: '0.25rem 0.625rem' }}
                  >
                    Execute <ArrowRight size={10} />
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Policy gap table ───────────────────────────────────────────────────────

function PolicyGapTable({ metrics }: { metrics: RiskMetrics }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <Shield size={14} color="var(--teal)" />
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Policy Gap by Currency</span>
        {!metrics.hasPolicy && (
          <span className="badge badge-amber" style={{ marginLeft: 'auto', fontSize: '0.625rem' }}>No policy configured</span>
        )}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th className="text-right">Exposure</th>
            <th className="text-right">Hedged</th>
            <th className="text-right">Coverage</th>
            <th className="text-right">VaR (95%)</th>
            <th className="text-right">Vol</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {metrics.currencyRisks.map(cr => {
            const breach = cr.coveragePct < metrics.policyMinPct
            const over   = cr.coveragePct > metrics.policyMaxPct
            const status = breach ? 'Under-hedged' : over ? 'Over-hedged' : 'Compliant'
            const badgeCls = breach ? 'badge-red' : over ? 'badge-amber' : 'badge-green'
            return (
              <tr key={cr.pair}>
                <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{cr.pair}</td>
                <td className="text-right mono">{fmt(cr.exposureUsd)}</td>
                <td className="text-right mono">{fmt(cr.hedgedUsd)}</td>
                <td className="text-right">
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: breach ? 'var(--red)' : over ? 'var(--amber)' : 'var(--teal)',
                  }}>
                    {cr.coveragePct.toFixed(1)}%
                  </span>
                </td>
                <td className="text-right mono" style={{ color: 'var(--text-secondary)' }}>
                  {fmt(cr.var95Usd)}
                </td>
                <td className="text-right mono" style={{ color: 'var(--text-secondary)' }}>
                  {cr.annualVolPct.toFixed(1)}%
                </td>
                <td><span className={`badge ${badgeCls}`} style={{ fontSize: '0.625rem' }}>{status}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function AdvisorPage() {
  const navigate = useNavigate()
  const {
    riskMetrics, strategies, backtest, aiAnalysis,
    loading, historyLoading, aiLoading, aiConfigured, error, refresh,
  } = useAdvisorEngine()
  const { ratesMap } = useLiveFxRates()
  const { combinedCoverage } = useCombinedCoverage()
  const { positions } = useHedgePositions()
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState(0)

  // Navigate to Hedge page pre-filled for a specific currency gap
  function handleExecute(cr?: CurrencyRisk, strategyGapUsd?: number) {
    if (!riskMetrics || strategies.length === 0) return
    const top = strategies[selectedStrategyIdx] ?? strategies[0]
    const pair = cr?.pair ?? riskMetrics.primaryPair
    const valueDate = new Date()
    valueDate.setMonth(valueDate.getMonth() + top.recommendedTenorMonths)
    // Look up live spot rate for this pair (try both directions)
    const liveRate = ratesMap[pair]
      ?? (ratesMap[pair.split('/').reverse().join('/')]
          ? 1 / ratesMap[pair.split('/').reverse().join('/')]
          : 0)
    // Use the strategy-adjusted gap if provided, else fall back to policy min gap
    const [baseCcy] = pair.split('/')
    const gapUsd = strategyGapUsd ?? (cr ? Math.abs(cr.gapToMinPolicyUsd) : riskMetrics.hedgeGapUsd)
    const baseNotional = baseCcy === 'USD' || liveRate <= 0
      ? Math.round(gapUsd)
      : Math.round(gapUsd / liveRate)
    // Use the strategy's primary instrument type
    const instrumentType = top.instruments[0]?.type.toLowerCase().includes('option') ? 'option'
      : top.instruments[0]?.type.toLowerCase().includes('swap') ? 'swap'
      : 'forward'
    navigate('/hedge', {
      state: {
        prefill: {
          instrument_type:  instrumentType,
          currency_pair:    pair,
          direction:        'sell',
          notional_base:    baseNotional,
          value_date:       valueDate.toISOString().split('T')[0],
          contracted_rate:  liveRate > 0 ? parseFloat(liveRate.toFixed(6)) : 0,
        },
      },
    })
  }

  // Scroll to execution plan from CFO section
  function handleScrollToExecutionPlan() {
    document.getElementById('execution-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Empty state ──────────────────────────────────────────
  if (!loading && riskMetrics && riskMetrics.totalExposureUsd === 0) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hedge Advisor</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>AI-powered analysis · Deterministic risk engine</p>
          </div>
        </div>
        <div className="page-content">
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <Brain size={32} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No exposure data yet</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: 380, margin: '0 auto 1.5rem' }}>
              Upload your exposure data on the Exposure tab and the Advisor will analyse your position, quantify your risk, and recommend the optimal hedging strategy.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/exposure')}>
              Go to Exposure <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hedge Advisor</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              {historyLoading ? 'Loading 24-month rate history…' : 'Computing risk metrics…'}
            </p>
          </div>
        </div>
        <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Skeleton h={24} w="60%" />
            <Skeleton h={14} />
            <Skeleton h={14} w="80%" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginTop: '0.5rem' }}>
              <Skeleton h={80} /><Skeleton h={80} /><Skeleton h={80} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <Skeleton h={220} /><Skeleton h={220} /><Skeleton h={220} />
          </div>
        </div>
      </div>
    )
  }

  if (!riskMetrics || strategies.length === 0) return null

  const topStrategy = strategies[0]

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hedge Advisor</h1>
            {aiLoading && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={11} className="animate-spin" /> Quova AI is analysing…
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            AI-powered · Deterministic risk engine · ECB rate history
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {error && <span style={{ fontSize: '0.75rem', color: 'var(--amber)' }}>{error}</span>}
          <button className="btn btn-ghost btn-sm" onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* CFO Section */}
        <CfoSection
          ai={aiAnalysis}
          metrics={riskMetrics}
          topStrategy={topStrategy}
          aiLoading={aiLoading}
          aiConfigured={aiConfigured}
          onExecute={handleScrollToExecutionPlan}
        />

        {/* Treasurer divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.25rem 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.75rem', borderRadius: 20, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <TrendingDown size={12} color="var(--text-muted)" />
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Treasurer Analysis
            </span>
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* Strategy cards */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.75rem' }}>
            <Zap size={13} color="var(--teal)" />
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>3 Ranked Strategies</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>— scored by risk reduction, cost, policy fit &amp; execution</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {strategies.map((s, i) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                rank={i + 1}
                tradesCount={riskMetrics.currencyRisks.filter(cr => cr.gapToMinPolicyUsd < 0).length}
                isSelected={selectedStrategyIdx === i}
                onSelect={() => setSelectedStrategyIdx(i)}
              />
            ))}
          </div>
        </div>

        {/* Execution plan */}
        <ExecutionPlan
          metrics={riskMetrics}
          strategy={strategies[selectedStrategyIdx] ?? strategies[0]}
          onExecute={handleExecute}
        />

        {/* Backtest chart */}
        {backtest && backtest.monthlyData.length > 0 && (
          <BacktestChart backtest={backtest} />
        )}

        {/* Policy gap table */}
        <PolicyGapTable metrics={riskMetrics} />

        {/* Scenario Analysis & Stress Testing */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.125rem' }}>
              <TrendingDown size={14} color="var(--teal)" />
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Scenario Analysis &amp; Stress Testing</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Model the P&amp;L impact of specific rate moves on your current portfolio.
            </p>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <ScenarioPanel
              combinedCoverage={combinedCoverage}
              positions={positions}
              ratesMap={ratesMap}
            />
          </div>
        </div>

        {/* Confidence footer */}
        {aiAnalysis?.confidenceNote && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem 1rem', borderRadius: 'var(--r-sm)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <Info size={12} color="var(--text-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              <strong>Data confidence: </strong>{aiAnalysis.confidenceNote}
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
